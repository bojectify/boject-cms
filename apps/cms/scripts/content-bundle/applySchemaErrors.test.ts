import { describe, expect, it } from 'vitest';
import {
  SchemaApplyBlockedError,
  SchemaApplyValidationError,
  SchemaChangedDuringApplyError,
} from './applySchemaErrors';
import type { Blocker, SchemaPlan } from './schemaPlan.types';

describe('applySchemaErrors', () => {
  it('SchemaApplyValidationError carries code and validation errors', () => {
    const err = new SchemaApplyValidationError([
      { path: 'contentTypes[0].name', message: 'must be a non-empty string' },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('BUNDLE_INVALID');
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0]!.path).toBe('contentTypes[0].name');
    expect(err.message).toContain('Bundle validation failed');
  });

  it('SchemaApplyBlockedError carries blockers and the plan', () => {
    const blockers: Blocker[] = [
      {
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: 'cannot remove',
        path: 'contentTypes.Article',
      },
    ];
    const plan: SchemaPlan = {
      contentTypes: { create: [], update: [], remove: [] },
      fields: { create: [], update: [], remove: [] },
      warnings: [],
      blockers,
    };
    const err = new SchemaApplyBlockedError(blockers, plan);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SCHEMA_APPLY_BLOCKED');
    expect(err.blockers).toBe(blockers);
    expect(err.plan).toBe(plan);
    expect(err.message).toContain('1 blocker');
  });

  it('SchemaChangedDuringApplyError carries code', () => {
    const err = new SchemaChangedDuringApplyError();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SCHEMA_CHANGED_DURING_APPLY');
    expect(err.message).toContain('Schema changed');
  });
});
