// apps/cms/scripts/content-bundle/planSchema.ts
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan. No side effects, no
// Prisma. The applier (Spec 3) consumes the plan inside a transaction.
//
// The diff matrix is documented in
// docs/superpowers/specs/2026-05-01-schema-as-code-planner-design.md.
// Each row maps to a small predicate inside this file.

import type {
  Bundle,
  CurrentSchemaSnapshot,
  PlanOptions,
  SchemaPlan,
} from './schemaPlan.types';

export function planSchema(
  _bundle: Bundle,
  _current: CurrentSchemaSnapshot,
  _options?: PlanOptions
): SchemaPlan {
  return {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };
}
