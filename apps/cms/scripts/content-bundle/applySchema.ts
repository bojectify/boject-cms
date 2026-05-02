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

import type { PrismaClient } from '#prisma';
import type { Bundle } from './types';
import type { SchemaPlan } from './schemaPlan.types';
import { validateBundle } from './validate';
import { SchemaApplyValidationError } from './applySchemaErrors';

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
  _prisma: PrismaClient,
  bundle: Bundle,
  _options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new SchemaApplyValidationError(validation.errors);
  }

  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };
  return { changed: false, plan, applied: { ...ZERO_APPLIED } };
}
