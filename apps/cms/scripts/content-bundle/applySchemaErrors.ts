// apps/cms/scripts/content-bundle/applySchemaErrors.ts
//
// Error classes thrown by applySchema. Pure module — no Prisma, no h3.
// Callers (Spec 4 entrypoint, Spec 5 API endpoint) branch on the
// `code` property to map these to exit codes / HTTP statuses.

import type { Blocker, SchemaPlan } from './schemaPlan.types';

export interface BundleValidationError {
  path: string;
  message: string;
}

export class SchemaApplyValidationError extends Error {
  readonly code = 'BUNDLE_INVALID' as const;
  readonly errors: BundleValidationError[];

  constructor(errors: BundleValidationError[]) {
    super(
      `Bundle validation failed with ${errors.length} error(s): ${errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ')}`
    );
    this.name = 'SchemaApplyValidationError';
    this.errors = errors;
  }
}

export class SchemaApplyBlockedError extends Error {
  readonly code = 'SCHEMA_APPLY_BLOCKED' as const;
  readonly blockers: Blocker[];
  readonly plan: SchemaPlan;

  constructor(blockers: Blocker[], plan: SchemaPlan) {
    super(
      `Schema apply blocked by ${blockers.length} blocker(s): ${blockers
        .map((b) => `[${b.code}] ${b.message}`)
        .join('; ')}`
    );
    this.name = 'SchemaApplyBlockedError';
    this.blockers = blockers;
    this.plan = plan;
  }
}

export class SchemaChangedDuringApplyError extends Error {
  readonly code = 'SCHEMA_CHANGED_DURING_APPLY' as const;

  constructor() {
    super('Schema changed between plan time and apply time. Re-run apply.');
    this.name = 'SchemaChangedDuringApplyError';
  }
}
