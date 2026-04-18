import { describe, it, expect } from 'vitest';
import {
  isUuid,
  assertUuid,
  assertNonNegativeInt,
  assertStringLength,
} from './validation';

describe('validation utilities', () => {
  describe('isUuid', () => {
    it('accepts a valid v4 UUID', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isUuid('')).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isUuid(undefined)).toBe(false);
    });

    it('rejects non-uuid string', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
    });

    it('rejects numbers', () => {
      expect(isUuid(42 as unknown as string)).toBe(false);
    });
  });

  describe('assertUuid', () => {
    it('passes through a valid UUID', () => {
      const id = '123e4567-e89b-12d3-a456-426614174000';
      expect(assertUuid(id, 'id')).toBe(id);
    });

    it('throws 400 for invalid UUID', () => {
      expect(() => assertUuid('nope', 'id')).toThrow(/id must be a valid UUID/);
    });

    it('throws 400 for undefined', () => {
      expect(() => assertUuid(undefined, 'id')).toThrow(
        /id must be a valid UUID/
      );
    });
  });

  describe('assertNonNegativeInt', () => {
    it('passes 0', () => {
      expect(assertNonNegativeInt(0, 'order')).toBe(0);
    });

    it('passes 42', () => {
      expect(assertNonNegativeInt(42, 'order')).toBe(42);
    });

    it('rejects negative', () => {
      expect(() => assertNonNegativeInt(-1, 'order')).toThrow(
        /order must be a non-negative integer/
      );
    });

    it('rejects NaN', () => {
      expect(() => assertNonNegativeInt(NaN, 'order')).toThrow();
    });

    it('rejects Infinity', () => {
      expect(() => assertNonNegativeInt(Infinity, 'order')).toThrow();
    });

    it('rejects non-integer', () => {
      expect(() => assertNonNegativeInt(1.5, 'order')).toThrow();
    });

    it('rejects strings', () => {
      expect(() =>
        assertNonNegativeInt('1' as unknown as number, 'order')
      ).toThrow();
    });
  });

  describe('assertStringLength', () => {
    it('passes a normal string', () => {
      expect(assertStringLength('hello', 'name', 200)).toBe('hello');
    });

    it('passes an empty string', () => {
      expect(assertStringLength('', 'name', 200)).toBe('');
    });

    it('rejects a string longer than max', () => {
      const long = 'a'.repeat(201);
      expect(() => assertStringLength(long, 'name', 200)).toThrow(
        /name exceeds max length of 200/
      );
    });

    it('rejects non-strings', () => {
      expect(() =>
        assertStringLength(123 as unknown as string, 'name', 200)
      ).toThrow(/name must be a string/);
    });
  });
});
