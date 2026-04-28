import { describe, it, expect } from 'vitest';
import { isObject } from './isObject';

describe('isObject', () => {
  it('returns true for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(Object.create(null))).toBe(true);
  });

  it('returns false for null and undefined', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isObject('string')).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(Symbol('s'))).toBe(false);
  });

  it('returns false for functions', () => {
    expect(isObject(() => {})).toBe(false);
    expect(isObject(function named() {})).toBe(false);
  });

  it('narrows the type to Record<string, unknown>', () => {
    const value: unknown = { foo: 'bar' };
    if (isObject(value)) {
      const keys: string[] = Object.keys(value);
      expect(keys).toEqual(['foo']);
    }
  });
});
