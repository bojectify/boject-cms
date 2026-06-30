// apps/cms/scripts/content-bundle/applySchema.ts
//
// Idempotent schema apply. Reads current state, computes a plan
// against the bundle, applies any safe operations inside a single
// transaction. Spec 3.
//
// Throws:
// - SchemaApplyValidationError — bundle failed validateBundle.
// - SchemaApplyBlockedError — plan has blockers; transaction rolls back.
// - SchemaChangedDuringApplyError — schema changed between two snapshots
//   inside the transaction. Caller should re-run.

import type { Prisma, PrismaClient } from '#prisma';
import type { Bundle, BundleField } from './types';
import type { CurrentSchemaSnapshot, SchemaPlan } from './schemaPlan.types';
import { effectiveBundleUnique } from './schemaPlan.types';
import { validateBundle } from './validate';
import { checkFieldDefault } from '../../utils/fieldDefaults';
import { isReservedFieldIdentifier } from '../../utils/reservedFieldIdentifiers';
import {
  SchemaApplyBlockedError,
  SchemaApplyValidationError,
  SchemaChangedDuringApplyError,
  type BundleValidationError,
} from './applySchemaErrors';
import { snapshotCurrentSchema } from './snapshotCurrentSchema';
import { planSchema } from './planSchema';
import { plansEqual } from './plansEqual';
import { enqueueContentTypeSchemaChanged } from '../../server/utils/webhooks';
// invalidateSchema is loaded lazily — the docker entrypoint runs this
// applier from a tsx process where the apps/cms/server/ tree isn't on
// disk (Nuxt hasn't booted, so there's no cached schema to clear anyway).
// In Nuxt-context callers (CLI `pnpm content:import`, future Spec 5 HTTP),
// the dynamic import resolves to the same module record as a static
// import would, so existing test spies on `schemaModule.invalidateSchema`
// still intercept the call.
async function invalidateSchemaIfAvailable(): Promise<void> {
  try {
    const mod = await import('../../server/graphql/schema');
    mod.invalidateSchema();
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND'
    ) {
      return;
    }
    throw err;
  }
}

export interface ApplySchemaOptions {
  allowDestructive?: boolean;
  /**
   * If true, run the planner + every mutation inside the transaction
   * but throw a sentinel before the transaction commits so the caller
   * gets back a fully-populated result without changing DB state.
   * Used by Spec 5's HTTP apply endpoint to power `boject schema apply --dry-run`.
   */
  dryRun?: boolean;
}

/**
 * Sentinel error used to roll back the apply transaction when
 * `options.dryRun` is set. Caught at the post-transaction boundary —
 * the captured result is still returned to the caller.
 */
class DryRunRollback extends Error {
  readonly code = 'DRY_RUN_ROLLBACK' as const;
}

export interface ApplySchemaResult {
  /** Whether any mutations were executed. False = plan was empty (no-op). */
  changed: boolean;
  plan: SchemaPlan;
  applied: {
    contentTypesCreated: number;
    contentTypesUpdated: number;
    contentTypesRemoved: number;
    fieldsCreated: number;
    fieldsUpdated: number;
    fieldsRemoved: number;
  };
}

const ZERO_APPLIED: ApplySchemaResult['applied'] = {
  contentTypesCreated: 0,
  contentTypesUpdated: 0,
  contentTypesRemoved: 0,
  fieldsCreated: 0,
  fieldsUpdated: 0,
  fieldsRemoved: 0,
};

/**
 * #393: the EXISTING content types whose fields changed in this plan — those
 * are the types whose entries' search docs + cached lists go stale. Excludes
 * brand-new types (contentTypes.create — no entries) and name/description-only
 * updates (not in the field-op set). Removals are out of scope (#404).
 */
function collectFieldChangedTypes(
  plan: SchemaPlan,
  snapshot: CurrentSchemaSnapshot
): Array<{ id: string; identifier: string }> {
  const created = new Set(plan.contentTypes.create.map((c) => c.identifier));
  const idByIdentifier = new Map(
    snapshot.contentTypes.map((c) => [c.identifier, c.id] as const)
  );
  const affected = new Map<string, { id: string; identifier: string }>();
  for (const op of plan.fields.create) {
    if (created.has(op.contentTypeIdentifier)) continue;
    affected.set(op.contentTypeIdentifier, {
      id: op.contentTypeId,
      identifier: op.contentTypeIdentifier,
    });
  }
  for (const op of [...plan.fields.update, ...plan.fields.remove]) {
    if (created.has(op.contentTypeIdentifier)) continue;
    // already captured via fields.create for this type — its contentTypeId is authoritative from there
    if (affected.has(op.contentTypeIdentifier)) continue;
    const id = idByIdentifier.get(op.contentTypeIdentifier);
    if (id) {
      affected.set(op.contentTypeIdentifier, {
        id,
        identifier: op.contentTypeIdentifier,
      });
    }
  }
  return [...affected.values()];
}

export async function applySchema(
  prisma: PrismaClient,
  bundle: Bundle,
  options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new SchemaApplyValidationError(validation.errors);
  }

  // Per-field semantic validation the offline validateBundle doesn't carry:
  // reserved-identifier rejection (a field whose identifier collides with the
  // built-in entry envelope) + field-default validation (#344 — default on an
  // unsupported type, a type-mismatched default, or a required BOOLEAN with no
  // True/False default). Both are rejected by the CMS UI + field REST API, so
  // the import path enforces them here too.
  const fieldErrors: BundleValidationError[] = [];
  for (const ct of bundle.contentTypes ?? []) {
    for (const field of ct.fields) {
      if (isReservedFieldIdentifier(field.identifier)) {
        fieldErrors.push({
          path: `contentTypes.${ct.identifier}.fields.${field.identifier}`,
          message: `Field identifier '${field.identifier}' is reserved (it collides with a built-in entry field).`,
        });
      }
      const message = checkFieldDefault(
        field.type,
        field.options,
        field.required
      );
      if (message) {
        fieldErrors.push({
          path: `contentTypes.${ct.identifier}.fields.${field.identifier}`,
          message,
        });
      }
    }
  }
  if (fieldErrors.length > 0) {
    throw new SchemaApplyValidationError(fieldErrors);
  }

  let captured: ApplySchemaResult | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // The transaction client is structurally compatible with the
      // PrismaClient methods snapshotCurrentSchema calls (findMany,
      // groupBy). Cast is justified — the runtime contract holds.
      const snapshot = await snapshotCurrentSchema(tx as PrismaClient);
      const plan: SchemaPlan = planSchema(bundle, snapshot, {
        allowDestructive: options.allowDestructive,
      });

      if (plan.blockers.length > 0) {
        throw new SchemaApplyBlockedError(plan.blockers, plan);
      }

      // Skip the re-plan + mutation walk if the plan is empty — nothing
      // to apply, nothing to race against.
      if (!isPlanNonEmpty(plan)) {
        captured = { changed: false, plan, applied: { ...ZERO_APPLIED } };
        return captured;
      }

      // Re-snapshot inside the same transaction and recompute the plan.
      // If anything diverges, a concurrent writer mutated the schema
      // between the two reads — abort and roll back so the caller can
      // re-run against the now-current state.
      const snapshot2 = await snapshotCurrentSchema(tx as PrismaClient);
      const plan2 = planSchema(bundle, snapshot2, {
        allowDestructive: options.allowDestructive,
      });
      if (!plansEqual(plan, plan2)) {
        throw new SchemaChangedDuringApplyError();
      }

      const applied: ApplySchemaResult['applied'] = { ...ZERO_APPLIED };

      // Build identifier → typeId map from the current snapshot. New
      // types are added to this map as Pass 1 creates them so cross-type
      // references resolve in a single transaction (mirrors import.ts).
      const identifierToTypeId = new Map<string, string>();
      for (const ct of snapshot.contentTypes) {
        identifierToTypeId.set(ct.identifier, ct.id);
      }

      // Fields whose RELATION/MULTIRELATION targets couldn't be resolved
      // at write time (because the target type was being created in this
      // same apply). Resolved in a Pass 2.5 once every type exists.
      const pendingFieldTargets: Array<{
        fieldId: string;
        identifiers: string[];
        otherOptions: Record<string, unknown>;
      }> = [];

      // Pass 1: content-type creates (with fields embedded).
      for (const bt of plan.contentTypes.create) {
        const created = await tx.contentType.create({
          data: {
            identifier: bt.identifier,
            name: bt.name,
            description: bt.description ?? undefined,
            fields: {
              create: bt.fields.map((f) =>
                toFieldCreatePayload(f, identifierToTypeId)
              ),
            },
          },
          include: { fields: true },
        });
        identifierToTypeId.set(created.identifier, created.id);
        // Queue any field whose targets included an as-yet-unknown type.
        for (const bf of bt.fields) {
          const pending = extractPendingTargets(bf, identifierToTypeId);
          if (!pending) continue;
          const dbField = created.fields.find(
            (f) => f.identifier === bf.identifier
          );
          if (!dbField) continue;
          pendingFieldTargets.push({
            fieldId: dbField.id,
            identifiers: pending.identifiers,
            otherOptions: pending.otherOptions,
          });
        }
        applied.contentTypesCreated += 1;
      }

      // Pass 1: content-type updates (name + description only — identifier
      // is immutable, planner already enforced).
      for (const update of plan.contentTypes.update) {
        await tx.contentType.update({
          where: { id: update.id },
          data: update.changes,
        });
        applied.contentTypesUpdated += 1;
      }

      // Pass 1: content-type removes. Prisma's onDelete: Cascade cleans up
      // fields — no need to walk fields.remove for these types.
      const removedTypeIds = new Set<string>();
      for (const removal of plan.contentTypes.remove) {
        await tx.contentType.delete({ where: { id: removal.id } });
        applied.contentTypesRemoved += 1;
        removedTypeIds.add(removal.id);
      }

      // Pass 2: field creates on existing types.
      for (const create of plan.fields.create) {
        const dbField = await tx.contentTypeField.create({
          data: {
            contentTypeId: create.contentTypeId,
            ...toFieldCreatePayload(create.field, identifierToTypeId),
          },
        });
        const pending = extractPendingTargets(create.field, identifierToTypeId);
        if (pending) {
          pendingFieldTargets.push({
            fieldId: dbField.id,
            identifiers: pending.identifiers,
            otherOptions: pending.otherOptions,
          });
        }
        applied.fieldsCreated += 1;
      }

      // Pass 2: field updates. Sparse changes object — only set
      // properties that are present in the diff. Planner already
      // validated each change is safe.
      for (const update of plan.fields.update) {
        const data: Prisma.ContentTypeFieldUpdateInput = {};
        if (update.changes.name !== undefined) data.name = update.changes.name;
        if (update.changes.order !== undefined)
          data.order = update.changes.order;
        if (update.changes.required !== undefined)
          data.required = update.changes.required;
        if (update.changes.unique !== undefined)
          data.unique = update.changes.unique;
        if (update.changes.options !== undefined) {
          data.options = resolveOptionsForStorage(
            update.changes.options as Record<string, unknown>,
            identifierToTypeId
          ) as Prisma.InputJsonValue;
        }
        await tx.contentTypeField.update({ where: { id: update.id }, data });
        applied.fieldsUpdated += 1;
      }

      // Pass 2.5: backfill RELATION/MULTIRELATION target IDs for fields
      // whose target types didn't exist at field-create time.
      for (const pending of pendingFieldTargets) {
        const resolved = pending.identifiers.map((ident) => {
          const id = identifierToTypeId.get(ident);
          if (!id) {
            throw new Error(
              `RELATION field references unknown content type "${ident}" after apply`
            );
          }
          return id;
        });
        await tx.contentTypeField.update({
          where: { id: pending.fieldId },
          data: {
            options: {
              ...pending.otherOptions,
              targetContentTypeIds: resolved,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // Pass 2: field removes. Skip any field whose owning content type was
      // just removed in pass 1 — Prisma's cascade already deleted those.
      for (const removal of plan.fields.remove) {
        const ownerWasRemoved =
          removedTypeIds.size > 0 &&
          snapshot.contentTypes.some(
            (c) =>
              removedTypeIds.has(c.id) &&
              c.fields.some((f) => f.id === removal.id)
          );
        if (ownerWasRemoved) continue;
        await tx.contentTypeField.delete({ where: { id: removal.id } });
        applied.fieldsRemoved += 1;
      }

      // #393: reconcile derived stores (search + cache) for existing types whose
      // fields changed. Inside the tx → rolled back on dryRun with everything else.
      for (const contentType of collectFieldChangedTypes(plan, snapshot)) {
        await enqueueContentTypeSchemaChanged(tx, { contentType });
      }

      const changed = isPlanNonEmpty(plan);
      const result: ApplySchemaResult = { changed, plan, applied };
      captured = result;
      // Roll the transaction back when caller asked for a dry run —
      // the captured result is still returned via the catch below.
      if (options.dryRun) throw new DryRunRollback();
      return result;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      // captured is set; fall through to the post-transaction return.
    } else {
      throw err;
    }
  }

  // captured is always set here:
  // - happy path (commit): the transaction body assigned it before returning.
  // - dryRun path: assigned before throwing DryRunRollback.
  // - no-op early return: assigned before returning.
  const txResult = captured!;

  // Invalidate the cached GraphQL schema so the next request rebuilds
  // against the freshly mutated content types. Skip on no-op applies —
  // the entrypoint runs apply on every boot and most boots are no-ops.
  // Also skip on dryRun: nothing changed in the DB, nothing to invalidate.
  if (txResult.changed && !options.dryRun) {
    await invalidateSchemaIfAvailable();
  }
  return txResult;
}

function toFieldCreatePayload(
  f: BundleField,
  identifierToTypeId: Map<string, string>
) {
  return {
    identifier: f.identifier,
    name: f.name,
    type: f.type,
    required: f.required,
    unique: effectiveBundleUnique(f),
    order: f.order,
    options: (resolveOptionsForStorage(f.options ?? null, identifierToTypeId) ??
      undefined) as Prisma.InputJsonValue | undefined,
  };
}

/**
 * Convert bundle-form field options (identifiers in
 * `targetContentTypeIdentifiers`) into DB-form options (UUIDs in
 * `targetContentTypeIds`). The Nuxt runtime (GraphQL, validation)
 * reads `targetContentTypeIds`, so applySchema must store UUIDs the
 * same way importBundle does — otherwise the entrypoint applier
 * corrupts the runtime state.
 *
 * If any identifier doesn't resolve in the supplied map (e.g. its
 * target type is being created later in the same apply), the
 * unresolved entries get a placeholder ID of empty-string slot and
 * the caller should detect this via `extractPendingTargets`. We don't
 * silently drop unresolved targets here; we just keep what we can and
 * the caller does a Pass 2.5 update.
 */
function resolveOptionsForStorage(
  options: Record<string, unknown> | null,
  identifierToTypeId: Map<string, string>
): Record<string, unknown> | null {
  if (!options) return null;
  const idents = options.targetContentTypeIdentifiers;
  if (!Array.isArray(idents)) return options;

  const resolved: string[] = [];
  for (const ident of idents) {
    if (typeof ident !== 'string') continue;
    const id = identifierToTypeId.get(ident);
    if (id) resolved.push(id);
  }
  const {
    targetContentTypeIdentifiers: _omitIdents,
    targetContentTypeIds: _omitIds,
    ...rest
  } = options;
  void _omitIdents;
  void _omitIds;
  return { ...rest, targetContentTypeIds: resolved };
}

/**
 * If any of `targetContentTypeIdentifiers` doesn't yet resolve in the
 * supplied map, return the full set so the caller can defer to Pass 2.5.
 * Returns null when every identifier resolves (or when there are no
 * relation targets at all).
 */
function extractPendingTargets(
  f: BundleField,
  identifierToTypeId: Map<string, string>
): { identifiers: string[]; otherOptions: Record<string, unknown> } | null {
  const opts = f.options;
  if (!opts) return null;
  const idents = opts.targetContentTypeIdentifiers;
  if (!Array.isArray(idents) || idents.length === 0) return null;
  const allResolve = idents.every(
    (i) => typeof i === 'string' && identifierToTypeId.has(i)
  );
  if (allResolve) return null;
  const {
    targetContentTypeIdentifiers: _omitIdents,
    targetContentTypeIds: _omitIds,
    ...otherOptions
  } = opts;
  void _omitIdents;
  void _omitIds;
  return {
    identifiers: idents.filter((i): i is string => typeof i === 'string'),
    otherOptions,
  };
}

function isPlanNonEmpty(plan: SchemaPlan): boolean {
  return (
    plan.contentTypes.create.length > 0 ||
    plan.contentTypes.update.length > 0 ||
    plan.contentTypes.remove.length > 0 ||
    plan.fields.create.length > 0 ||
    plan.fields.update.length > 0 ||
    plan.fields.remove.length > 0
  );
}
