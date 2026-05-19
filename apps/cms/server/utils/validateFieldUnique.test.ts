import { describe, it, expect } from 'vitest';
import {
  isUniqueAllowedForType,
  resolveUniqueFlag,
} from './validateFieldUnique';
import { FIELD_TYPES } from '../../utils/fieldTypes';

describe('isUniqueAllowedForType', () => {
  it('allows TEXT and NUMBER', () => {
    expect(isUniqueAllowedForType(FIELD_TYPES.TEXT)).toBe(true);
    expect(isUniqueAllowedForType(FIELD_TYPES.NUMBER)).toBe(true);
  });

  it('allows ENTRY_TITLE and SLUG (implicit)', () => {
    expect(isUniqueAllowedForType(FIELD_TYPES.ENTRY_TITLE)).toBe(true);
    expect(isUniqueAllowedForType(FIELD_TYPES.SLUG)).toBe(true);
  });

  it('rejects other types', () => {
    expect(isUniqueAllowedForType(FIELD_TYPES.TEXTAREA)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.BOOLEAN)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.DATETIME)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.SELECT)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.RICHTEXT)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.RELATION)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.MULTIRELATION)).toBe(false);
    expect(isUniqueAllowedForType(FIELD_TYPES.IMAGE)).toBe(false);
  });
});

describe('resolveUniqueFlag', () => {
  it('forces true for ENTRY_TITLE regardless of requested', () => {
    expect(resolveUniqueFlag(FIELD_TYPES.ENTRY_TITLE, false)).toBe(true);
    expect(resolveUniqueFlag(FIELD_TYPES.ENTRY_TITLE, undefined)).toBe(true);
  });

  it('forces true for SLUG regardless of requested', () => {
    expect(resolveUniqueFlag(FIELD_TYPES.SLUG, false)).toBe(true);
    expect(resolveUniqueFlag(FIELD_TYPES.SLUG, undefined)).toBe(true);
  });

  it('uses requested value for TEXT and NUMBER', () => {
    expect(resolveUniqueFlag(FIELD_TYPES.TEXT, true)).toBe(true);
    expect(resolveUniqueFlag(FIELD_TYPES.TEXT, false)).toBe(false);
    expect(resolveUniqueFlag(FIELD_TYPES.NUMBER, true)).toBe(true);
  });

  it('defaults to false when not provided on TEXT/NUMBER', () => {
    expect(resolveUniqueFlag(FIELD_TYPES.TEXT, undefined)).toBe(false);
    expect(resolveUniqueFlag(FIELD_TYPES.NUMBER, undefined)).toBe(false);
  });

  it('defaults to false for other types when not requested', () => {
    expect(resolveUniqueFlag(FIELD_TYPES.BOOLEAN, undefined)).toBe(false);
  });

  it('throws when requesting unique: true on a disallowed type', () => {
    expect(() => resolveUniqueFlag(FIELD_TYPES.BOOLEAN, true)).toThrow(
      /unique is not supported/i
    );
    expect(() => resolveUniqueFlag(FIELD_TYPES.RICHTEXT, true)).toThrow();
  });
});
