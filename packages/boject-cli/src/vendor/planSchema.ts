// VENDORED from apps/cms/scripts/content-bundle/planSchema.ts.
// The CLI is published standalone and cannot import from apps/cms/.
// Keep this file in sync when the canonical version changes.
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan. No side effects, no
// Prisma. The applier (Spec 3) consumes the plan inside a transaction.
//
// The diff matrix is documented in ********.
// Each row maps to a small predicate inside this file.

import type { BundleContentType, BundleField } from './contentBundleTypes.js';
import type {
  Bundle,
  CurrentSchemaSnapshot,
  FieldUpdate,
  PlanOptions,
  SchemaPlan,
  TypeUpdate,
} from './schemaPlan.types.js';
import { effectiveBundleUnique } from './schemaPlan.types.js';

export function planSchema(
  bundle: Bundle,
  current: CurrentSchemaSnapshot,
  options: PlanOptions = {}
): SchemaPlan {
  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };

  const bundleTypes = bundle.contentTypes ?? [];
  const dbTypeByIdentifier = new Map(
    current.contentTypes.map((c) => [c.identifier, c])
  );
  const dbTypeById = new Map(current.contentTypes.map((c) => [c.id, c]));
  const bundleTypeIdentifiers = new Set(bundleTypes.map((c) => c.identifier));

  // Row 5: identifier-change detection. Only fires for non-portable
  // bundles where bt.id is non-null AND matches a DB row by id with
  // a different identifier. Track the bundle ids and matched DB ids
  // so the main walks can skip the corresponding noise (a spurious
  // create for the new identifier and a spurious removal blocker
  // for the old identifier).
  const renamingBundleTypeIdentifiers = new Set<string>();
  const renamedDbTypeIds = new Set<string>();
  for (const bt of bundleTypes) {
    if (!bt.id) continue;
    const dbByIdMatch = dbTypeById.get(bt.id);
    if (!dbByIdMatch) continue;
    if (dbByIdMatch.identifier !== bt.identifier) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_IDENTIFIER_CHANGE',
        message: `Cannot rename content type "${dbByIdMatch.identifier}" to "${bt.identifier}". Identifiers are immutable. To replace it, remove the old type and create a new one (allowDestructive is required if entries exist).`,
        path: `contentTypes.${bt.identifier}`,
      });
      renamingBundleTypeIdentifiers.add(bt.identifier);
      renamedDbTypeIds.add(dbByIdMatch.id);
    }
  }

  for (const bt of bundleTypes) {
    if (renamingBundleTypeIdentifiers.has(bt.identifier)) continue;
    const db = dbTypeByIdentifier.get(bt.identifier);
    if (!db) {
      plan.contentTypes.create.push(bt);
      continue;
    }

    const update = diffTypeMetadata(bt, db);
    if (update) plan.contentTypes.update.push(update);
    diffFieldsForType(plan, bt, db, current.fieldUsage, options);
  }

  for (const dbType of current.contentTypes) {
    if (bundleTypeIdentifiers.has(dbType.identifier)) continue;
    if (renamedDbTypeIds.has(dbType.id)) continue;

    if (dbType.entryCount > 0) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: `Cannot remove content type "${dbType.identifier}" — ${dbType.entryCount} entries exist. Delete entries first.`,
        path: `contentTypes.${dbType.identifier}`,
      });
      continue;
    }

    if (!options.allowDestructive) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
        message: `Cannot remove content type "${dbType.identifier}" without allowDestructive.`,
        path: `contentTypes.${dbType.identifier}`,
      });
      continue;
    }

    plan.contentTypes.remove.push({
      id: dbType.id,
      identifier: dbType.identifier,
      entryCount: dbType.entryCount,
    });
  }

  // Final cross-reference pass: RELATION/MULTIRELATION targets must exist in
  // either the bundle or the DB snapshot. Runs after all type-walk loops so a
  // target created in the same bundle resolves correctly.
  const allKnownTypeIdentifiers = new Set<string>([
    ...bundleTypes.map((c) => c.identifier),
    ...current.contentTypes.map((c) => c.identifier),
  ]);
  for (const bt of bundleTypes) {
    for (const bf of bt.fields) {
      if (bf.type !== 'RELATION' && bf.type !== 'MULTIRELATION') continue;
      const targets =
        (bf.options?.targetContentTypeIdentifiers as string[] | undefined) ??
        [];
      const missing = targets.filter((t) => !allKnownTypeIdentifiers.has(t));
      if (missing.length > 0) {
        plan.blockers.push({
          code: 'RELATION_TARGET_NOT_FOUND',
          message: `Field "${bt.identifier}.${bf.identifier}" targets unknown content type(s): ${missing.join(', ')}.`,
          path: `fields.${bt.identifier}.${bf.identifier}`,
        });
      }
    }
  }

  return plan;
}

function diffFieldUpdate(
  plan: SchemaPlan,
  typeIdentifier: string,
  bf: BundleField,
  dbField: CurrentSchemaSnapshot['contentTypes'][number]['fields'][number],
  entryCount: number,
  fieldUsage: CurrentSchemaSnapshot['fieldUsage']
): void {
  if (bf.type !== dbField.type) {
    plan.blockers.push({
      code: 'FIELD_TYPE_CHANGE',
      message: `Cannot change "${typeIdentifier}.${bf.identifier}" from ${dbField.type} to ${bf.type}. Type changes are never allowed; rename the field instead.`,
      path: `fields.${typeIdentifier}.${bf.identifier}`,
    });
    return; // skip all other update logic
  }

  const changes: FieldUpdate['changes'] = {};
  if (bf.name !== dbField.name) changes.name = bf.name;
  if (bf.order !== dbField.order) changes.order = bf.order;

  // required transitions (rows 10, 11, 12)
  if (bf.required !== dbField.required) {
    if (bf.required) {
      const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
      const entriesWithValue = usage?.entriesWithValue ?? 0;
      const missing = entryCount - entriesWithValue;
      if (missing > 0) {
        plan.blockers.push({
          code: 'OPTIONAL_TO_REQUIRED_HAS_NULLS',
          message: `Cannot mark "${bf.identifier}" required — ${missing} entries on "${typeIdentifier}" have a null/missing value for it. Backfill them first.`,
          path: `fields.${typeIdentifier}.${bf.identifier}`,
        });
      } else {
        changes.required = true;
      }
    } else {
      changes.required = false;
    }
  }

  // unique transitions (rows 13, 14, 15)
  const bundleUnique = effectiveBundleUnique(bf);
  if (bundleUnique !== dbField.unique) {
    if (bundleUnique) {
      const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
      const dups = usage?.duplicateValues ?? [];
      if (dups.length > 0) {
        const affectedEntryIds = dups.flatMap((d) => d.entryIds);
        plan.blockers.push({
          code: 'UNIQUE_CONFLICT',
          message: `Cannot mark "${bf.identifier}" unique — ${affectedEntryIds.length} entries on "${typeIdentifier}" share duplicate values.`,
          path: `fields.${typeIdentifier}.${bf.identifier}`,
          affectedEntryIds,
        });
      } else {
        changes.unique = true;
      }
    } else {
      changes.unique = false;
    }
  }

  // SELECT choice changes (rows 17, 18, 19)
  if (bf.type === 'SELECT') {
    const bundleChoices = (bf.options?.choices as string[] | undefined) ?? [];
    const dbChoices = (dbField.options?.choices as string[] | undefined) ?? [];
    const removed = dbChoices.filter((c) => !bundleChoices.includes(c));
    const added = bundleChoices.filter((c) => !dbChoices.includes(c));

    const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
    const usedRemoved = removed.filter(
      (c) => (usage?.selectChoiceCounts?.get(c) ?? 0) > 0
    );

    if (usedRemoved.length > 0) {
      const detail = usedRemoved
        .map((c) => `"${c}" (${usage?.selectChoiceCounts?.get(c)} entries)`)
        .join(', ');
      plan.blockers.push({
        code: 'SELECT_CHOICE_REMOVED_IN_USE',
        message: `Cannot remove SELECT choices in use on "${typeIdentifier}.${bf.identifier}": ${detail}. Update entries first.`,
        path: `fields.${typeIdentifier}.${bf.identifier}`,
      });
      return;
    }

    if (added.length > 0 || removed.length > 0) {
      changes.options = { ...(bf.options ?? {}), choices: bundleChoices };
    }
  }

  // RELATION/MULTIRELATION target changes (rows 20, 21, 22)
  if (bf.type === 'RELATION' || bf.type === 'MULTIRELATION') {
    const bundleTargets =
      (bf.options?.targetContentTypeIdentifiers as string[] | undefined) ?? [];
    const dbTargets =
      (dbField.options?.targetContentTypeIdentifiers as string[] | undefined) ??
      [];
    const removedTargets = dbTargets.filter((t) => !bundleTargets.includes(t));
    const addedTargets = bundleTargets.filter((t) => !dbTargets.includes(t));

    const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
    const usedRemoved = removedTargets.filter(
      (t) => (usage?.relationTargetCounts?.get(t) ?? 0) > 0
    );

    if (usedRemoved.length > 0) {
      const detail = usedRemoved
        .map((t) => `"${t}" (${usage?.relationTargetCounts?.get(t)} relations)`)
        .join(', ');
      plan.blockers.push({
        code: 'RELATION_TARGET_REMOVED_IN_USE',
        message: `Cannot remove relation targets in use on "${typeIdentifier}.${bf.identifier}": ${detail}. Update entries first.`,
        path: `fields.${typeIdentifier}.${bf.identifier}`,
      });
      return;
    }

    if (addedTargets.length > 0 || removedTargets.length > 0) {
      changes.options = {
        ...(bf.options ?? {}),
        targetContentTypeIdentifiers: bundleTargets,
      };
    }
  }

  // Generic options-diff fall-through (rows 23, 24)
  // SELECT, RELATION, MULTIRELATION are handled by their dedicated blocks above.
  const knownHandledTypes = new Set(['SELECT', 'RELATION', 'MULTIRELATION']);
  if (
    !knownHandledTypes.has(bf.type) &&
    !shallowOptionsEqual(bf.options, dbField.options)
  ) {
    changes.options = bf.options ?? {};
    // RICHTEXT is documented-safe in the spec (row 23) — no warning.
    if (bf.type !== 'RICHTEXT') {
      const unknownKeys = Object.keys(bf.options ?? {}).filter(
        (k) =>
          !(k in (dbField.options ?? {})) ||
          bf.options?.[k] !== dbField.options?.[k]
      );
      if (unknownKeys.length > 0) {
        plan.warnings.push({
          code: 'UNRECOGNISED_FIELD_OPTION',
          message: `Field "${typeIdentifier}.${bf.identifier}" has option keys the planner does not recognise: ${unknownKeys.join(', ')}. Passing through to the applier; Prisma will validate at apply time.`,
          path: `fields.${typeIdentifier}.${bf.identifier}`,
        });
      }
    }
  }

  if (Object.keys(changes).length === 0) return;
  plan.fields.update.push({
    id: dbField.id,
    contentTypeIdentifier: typeIdentifier,
    fieldIdentifier: bf.identifier,
    changes,
  });
}

function diffTypeMetadata(
  bt: BundleContentType,
  db: CurrentSchemaSnapshot['contentTypes'][number]
): TypeUpdate | null {
  const changes: TypeUpdate['changes'] = {};
  if (bt.name !== db.name) changes.name = bt.name;
  if (bt.description !== db.description) changes.description = bt.description;
  if (Object.keys(changes).length === 0) return null;
  return { id: db.id, identifier: bt.identifier, changes };
}

function shallowOptionsEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined
): boolean {
  if (a === b) return true;
  // Treat null, undefined, and {} as equivalent: a field with no
  // options on the bundle side and `options: null` on the DB side
  // (or vice versa) should not produce a spurious diff.
  const aObj = a ?? {};
  const bObj = b ?? {};
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (JSON.stringify(aObj[k]) !== JSON.stringify(bObj[k])) return false;
  }
  return true;
}

function diffFieldsForType(
  plan: SchemaPlan,
  bt: BundleContentType,
  db: CurrentSchemaSnapshot['contentTypes'][number],
  fieldUsage: CurrentSchemaSnapshot['fieldUsage'],
  options: PlanOptions = {}
): void {
  const dbFieldByIdentifier = new Map(db.fields.map((f) => [f.identifier, f]));
  const dbFieldById = new Map(db.fields.map((f) => [f.id, f]));

  // Field-identifier-change detection (analog of row 5 at field
  // level). Only fires for non-portable bundles where bf.id is
  // non-null and matches a DB field by id with a different
  // identifier. Mirrors the silent immutability the field PUT
  // endpoint already enforces.
  const renamingBundleFieldIdentifiers = new Set<string>();
  const renamedDbFieldIds = new Set<string>();
  for (const bf of bt.fields) {
    if (!bf.id) continue;
    const dbByIdMatch = dbFieldById.get(bf.id);
    if (!dbByIdMatch) continue;
    if (dbByIdMatch.identifier !== bf.identifier) {
      plan.blockers.push({
        code: 'FIELD_IDENTIFIER_CHANGE',
        message: `Cannot rename field "${dbByIdMatch.identifier}" to "${bf.identifier}" on "${bt.identifier}". Field identifiers are immutable; remove and re-create with allowDestructive instead.`,
        path: `fields.${bt.identifier}.${bf.identifier}`,
      });
      renamingBundleFieldIdentifiers.add(bf.identifier);
      renamedDbFieldIds.add(dbByIdMatch.id);
    }
  }

  for (const bf of bt.fields) {
    if (renamingBundleFieldIdentifiers.has(bf.identifier)) continue;
    const dbField = dbFieldByIdentifier.get(bf.identifier);
    if (!dbField) {
      plan.fields.create.push({
        contentTypeId: db.id,
        contentTypeIdentifier: bt.identifier,
        field: bf,
      });
      if (bf.required && db.entryCount > 0) {
        plan.warnings.push({
          code: 'NEW_REQUIRED_FIELD_WITH_ENTRIES',
          message: `New required field "${bf.identifier}" added to "${bt.identifier}" which has ${db.entryCount} entries. Existing entries will be missing this value until backfilled.`,
          path: `fields.${bt.identifier}.${bf.identifier}`,
        });
      }
      continue;
    }
    diffFieldUpdate(
      plan,
      bt.identifier,
      bf,
      dbField,
      db.entryCount,
      fieldUsage
    );
  }

  const bundleFieldIdentifiers = new Set(bt.fields.map((f) => f.identifier));
  for (const dbField of db.fields) {
    if (bundleFieldIdentifiers.has(dbField.identifier)) continue;
    if (renamedDbFieldIds.has(dbField.id)) continue; // Suppress noise from rename detection.

    if (!options.allowDestructive) {
      plan.blockers.push({
        code: 'FIELD_REMOVAL_NEEDS_FLAG',
        message: `Cannot remove field "${dbField.identifier}" from "${bt.identifier}" without allowDestructive.`,
        path: `fields.${bt.identifier}.${dbField.identifier}`,
      });
      continue;
    }

    const usage = fieldUsage.get(`${bt.identifier}:${dbField.identifier}`);
    const entriesWithValue = usage?.entriesWithValue ?? 0;
    plan.fields.remove.push({
      id: dbField.id,
      contentTypeIdentifier: bt.identifier,
      fieldIdentifier: dbField.identifier,
      entriesWithValue,
    });
    if (entriesWithValue > 0) {
      plan.warnings.push({
        code: 'FIELD_REMOVAL_DATA_LOSS',
        message: `Removing "${bt.identifier}.${dbField.identifier}" will wipe values held by ${entriesWithValue} entries.`,
        path: `fields.${bt.identifier}.${dbField.identifier}`,
      });
    }
  }
}
