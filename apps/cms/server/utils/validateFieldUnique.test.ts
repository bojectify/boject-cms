import { describe, it, expect } from 'vitest';
import {
  isUniqueAllowedForType,
  resolveUniqueFlag,
} from './validateFieldUnique';

describe('isUniqueAllowedForType', () => {
  it('allows TEXT and NUMBER', () => {
    expect(isUniqueAllowedForType('TEXT')).toBe(true);
    expect(isUniqueAllowedForType('NUMBER')).toBe(true);
  });

  it('allows ENTRY_TITLE and SLUG (implicit)', () => {
    expect(isUniqueAllowedForType('ENTRY_TITLE')).toBe(true);
    expect(isUniqueAllowedForType('SLUG')).toBe(true);
  });

  it('rejects other types', () => {
    expect(isUniqueAllowedForType('TEXTAREA')).toBe(false);
    expect(isUniqueAllowedForType('BOOLEAN')).toBe(false);
    expect(isUniqueAllowedForType('DATETIME')).toBe(false);
    expect(isUniqueAllowedForType('SELECT')).toBe(false);
    expect(isUniqueAllowedForType('RICHTEXT')).toBe(false);
    expect(isUniqueAllowedForType('RELATION')).toBe(false);
    expect(isUniqueAllowedForType('MULTIRELATION')).toBe(false);
    expect(isUniqueAllowedForType('IMAGE')).toBe(false);
  });
});

describe('resolveUniqueFlag', () => {
  it('forces true for ENTRY_TITLE regardless of requested', () => {
    expect(resolveUniqueFlag('ENTRY_TITLE', false)).toBe(true);
    expect(resolveUniqueFlag('ENTRY_TITLE', undefined)).toBe(true);
  });

  it('forces true for SLUG regardless of requested', () => {
    expect(resolveUniqueFlag('SLUG', false)).toBe(true);
    expect(resolveUniqueFlag('SLUG', undefined)).toBe(true);
  });

  it('uses requested value for TEXT and NUMBER', () => {
    expect(resolveUniqueFlag('TEXT', true)).toBe(true);
    expect(resolveUniqueFlag('TEXT', false)).toBe(false);
    expect(resolveUniqueFlag('NUMBER', true)).toBe(true);
  });

  it('defaults to false when not provided on TEXT/NUMBER', () => {
    expect(resolveUniqueFlag('TEXT', undefined)).toBe(false);
    expect(resolveUniqueFlag('NUMBER', undefined)).toBe(false);
  });

  it('defaults to false for other types when not requested', () => {
    expect(resolveUniqueFlag('BOOLEAN', undefined)).toBe(false);
  });

  it('throws when requesting unique: true on a disallowed type', () => {
    expect(() => resolveUniqueFlag('BOOLEAN', true)).toThrow(
      /unique is not supported/i
    );
    expect(() => resolveUniqueFlag('RICHTEXT', true)).toThrow();
  });
});
