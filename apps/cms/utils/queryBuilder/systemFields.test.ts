import { describe, it, expect } from 'vitest';
import {
  SYSTEM_FIELD_PREFIX,
  SYSTEM_FIELDS,
  isSystemFieldId,
  getSystemField,
  toQueryField,
} from './systemFields';
// Test-only import: src-level systemFields.ts must not import operators.ts
// (cycle avoidance), but a test can cross-check the registries.
import { FILTERABLE_FIELD_TYPES } from './operators';

describe('systemFields registry', () => {
  it('uses $ as the system-field prefix', () => {
    expect(SYSTEM_FIELD_PREFIX).toBe('$');
  });

  it('registers exactly one system field: $entryKey (SLUG donor, entryKey envelope path)', () => {
    expect(SYSTEM_FIELDS).toHaveLength(1);
    expect(SYSTEM_FIELDS[0]).toEqual({
      identifier: '$entryKey',
      name: 'Entry key',
      enginePath: 'entryKey',
      type: 'SLUG',
    });
  });

  it('every identifier carries the wire prefix', () => {
    for (const f of SYSTEM_FIELDS) {
      expect(f.identifier.startsWith(SYSTEM_FIELD_PREFIX)).toBe(true);
    }
  });

  it('every donor type is filterable (has an operator-registry entry)', () => {
    // Guards a future entry (e.g. #302's $status) against picking a donor type
    // with no operators — which would render a broken palette row and 400 on
    // the server.
    for (const f of SYSTEM_FIELDS) {
      expect(FILTERABLE_FIELD_TYPES).toContain(f.type);
    }
  });
});

describe('isSystemFieldId', () => {
  it('is true for any $-prefixed string (prefix-only shape check)', () => {
    expect(isSystemFieldId('$entryKey')).toBe(true);
    // Prefix-only: unknown tokens pass the shape check — the compiler 400s
    // them later via a getSystemField miss.
    expect(isSystemFieldId('$bogus')).toBe(true);
  });

  it('is false for unprefixed strings and the empty string', () => {
    expect(isSystemFieldId('entryKey')).toBe(false);
    expect(isSystemFieldId('')).toBe(false);
  });

  it('is false for non-string input', () => {
    expect(isSystemFieldId(undefined)).toBe(false);
    expect(isSystemFieldId(42)).toBe(false);
  });
});

describe('getSystemField', () => {
  it('returns the registry entry for a known identifier', () => {
    expect(getSystemField('$entryKey')).toEqual({
      identifier: '$entryKey',
      name: 'Entry key',
      enginePath: 'entryKey',
      type: 'SLUG',
    });
  });

  it('returns undefined for an unknown identifier', () => {
    expect(getSystemField('$bogus')).toBeUndefined();
  });
});

describe('toQueryField', () => {
  it('maps identifier/name/type and nothing else (no enginePath leak)', () => {
    const sys = getSystemField('$entryKey')!;
    expect(toQueryField(sys)).toStrictEqual({
      identifier: '$entryKey',
      name: 'Entry key',
      type: 'SLUG',
    });
  });
});
