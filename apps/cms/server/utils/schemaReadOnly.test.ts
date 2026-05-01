import { describe, expect, it } from 'vitest';
import { coerceSchemaReadonly } from './schemaReadOnly';

describe('coerceSchemaReadonly', () => {
  it('returns true for "true"', () => {
    expect(coerceSchemaReadonly('true')).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(coerceSchemaReadonly('1')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(coerceSchemaReadonly(undefined)).toBe(false);
  });

  it('returns false for the empty string', () => {
    expect(coerceSchemaReadonly('')).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(coerceSchemaReadonly('false')).toBe(false);
  });

  it('returns false for "0"', () => {
    expect(coerceSchemaReadonly('0')).toBe(false);
  });

  it('returns false for an unrelated string', () => {
    expect(coerceSchemaReadonly('yes')).toBe(false);
  });
});
