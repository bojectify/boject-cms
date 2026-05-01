// apps/cms/scripts/content-bundle/planSchema.ts
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan. No side effects, no
// Prisma. The applier (Spec 3) consumes the plan inside a transaction.
//
// The diff matrix is documented in
// docs/superpowers/specs/2026-05-01-schema-as-code-planner-design.md.
// Each row maps to a small predicate inside this file.

import type { BundleContentType } from './types';
import type {
  Bundle,
  CurrentSchemaSnapshot,
  PlanOptions,
  SchemaPlan,
  TypeUpdate,
} from './schemaPlan.types';

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

  return plan;
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
