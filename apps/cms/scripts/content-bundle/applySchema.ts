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
import type { SchemaPlan } from './schemaPlan.types';
import { effectiveBundleUnique } from './schemaPlan.types';
import { validateBundle } from './validate';
import {
  SchemaApplyBlockedError,
  SchemaApplyValidationError,
  SchemaChangedDuringApplyError,
} from './applySchemaErrors';
import { snapshotCurrentSchema } from './snapshotCurrentSchema';
import { planSchema } from './planSchema';
import { plansEqual } from './plansEqual';
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

export async function applySchema(
  prisma: PrismaClient,
  bundle: Bundle,
  options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new SchemaApplyValidationError(validation.errors);
  }

  const txResult = await prisma.$transaction(async (tx) => {
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
      return { changed: false, plan, applied: { ...ZERO_APPLIED } };
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

    // Pass 1: content-type creates (with fields embedded).
    for (const bt of plan.contentTypes.create) {
      await tx.contentType.create({
        data: {
          identifier: bt.identifier,
          name: bt.name,
          description: bt.description ?? undefined,
          fields: {
            create: bt.fields.map(toFieldCreatePayload),
          },
        },
      });
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
      await tx.contentTypeField.create({
        data: {
          contentTypeId: create.contentTypeId,
          ...toFieldCreatePayload(create.field),
        },
      });
      applied.fieldsCreated += 1;
    }

    // Pass 2: field updates. Sparse changes object — only set
    // properties that are present in the diff. Planner already
    // validated each change is safe.
    for (const update of plan.fields.update) {
      const data: Prisma.ContentTypeFieldUpdateInput = {};
      if (update.changes.name !== undefined) data.name = update.changes.name;
      if (update.changes.order !== undefined) data.order = update.changes.order;
      if (update.changes.required !== undefined)
        data.required = update.changes.required;
      if (update.changes.unique !== undefined)
        data.unique = update.changes.unique;
      if (update.changes.options !== undefined) {
        data.options = update.changes.options as Prisma.InputJsonValue;
      }
      await tx.contentTypeField.update({ where: { id: update.id }, data });
      applied.fieldsUpdated += 1;
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

    const changed = isPlanNonEmpty(plan);
    return { changed, plan, applied };
  });

  // Invalidate the cached GraphQL schema so the next request rebuilds
  // against the freshly mutated content types. Skip on no-op applies —
  // the entrypoint runs apply on every boot and most boots are no-ops.
  if (txResult.changed) {
    await invalidateSchemaIfAvailable();
  }
  return txResult;
}

function toFieldCreatePayload(f: BundleField) {
  return {
    identifier: f.identifier,
    name: f.name,
    type: f.type,
    required: f.required,
    unique: effectiveBundleUnique(f),
    order: f.order,
    options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined,
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
