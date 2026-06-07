import { describe, it, expect } from 'vitest';
import {
  availableOperators,
  defaultOperator,
  valueInputKind,
  FILTERABLE_FIELD_TYPES,
} from './operators';

describe('operators registry', () => {
  it('exposes the equality op as the v1 default for each filterable type', () => {
    for (const t of FILTERABLE_FIELD_TYPES) {
      expect(defaultOperator(t).id).toBe('eq');
    }
  });

  it('returns only the equality op when rich operators are off (v1)', () => {
    const ops = availableOperators('TEXT', { rich: false });
    expect(ops.map((o) => o.id)).toEqual(['eq']);
  });

  it('returns the full set when rich operators are on', () => {
    const ops = availableOperators('TEXT', { rich: true }).map((o) => o.id);
    expect(ops).toContain('eq');
    expect(ops).toContain('contains');
    expect(ops).toContain('startsWith');
  });

  it('maps field types to value-input kinds', () => {
    expect(valueInputKind('BOOLEAN', 'eq')).toBe('boolean');
    expect(valueInputKind('SELECT', 'eq')).toBe('select');
    expect(valueInputKind('NUMBER', 'eq')).toBe('number');
    expect(valueInputKind('DATETIME', 'eq')).toBe('datetime');
    expect(valueInputKind('RELATION', 'eq')).toBe('entry');
    expect(valueInputKind('MULTIRELATION', 'eq')).toBe('entry');
    expect(valueInputKind('TEXT', 'eq')).toBe('text');
  });

  it('excludes RICHTEXT and IMAGE from filterable types', () => {
    expect(FILTERABLE_FIELD_TYPES).not.toContain('RICHTEXT');
    expect(FILTERABLE_FIELD_TYPES).not.toContain('IMAGE');
  });
});
