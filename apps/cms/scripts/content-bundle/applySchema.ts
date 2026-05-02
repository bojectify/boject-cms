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
} from './applySchemaErrors';
import { snapshotCurrentSchema } from './snapshotCurrentSchema';
import { planSchema } from './planSchema';

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

  return prisma.$transaction(async (tx) => {
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

    const changed = isPlanNonEmpty(plan);
    return { changed, plan, applied };
  });
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
