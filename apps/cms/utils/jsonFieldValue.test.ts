import { describe, expect, it } from 'vitest';
import { JSON_FIELD_MAX_BYTES, jsonFieldValueError } from './jsonFieldValue';

const SHAPE = 'must be a JSON object or array';
const SIZE = 'exceeds the 256 KB limit';

describe('jsonFieldValueError', () => {
  it('caps values at 256 KB', () => {
    expect(JSON_FIELD_MAX_BYTES).toBe(262144);
  });

  it.each([
    ['empty object', {}],
    ['empty array', []],
    ['cipher key object', { b: 'e', c: 'd' }],
    ['array with nested scalars', [1, 'a', null, { x: [true] }]],
  ])('accepts %s', (_label, value) => {
    expect(jsonFieldValueError(value)).toBeNull();
  });

  it.each([
    ['string', 'str'],
    ['number', 42],
    ['boolean', true],
    ['null', null],
  ])('rejects a top-level %s', (_label, value) => {
    expect(jsonFieldValueError(value)).toBe(SHAPE);
  });

  it('accepts a value of exactly 256 KB', () => {
    // `{"s":"…"}` adds 8 characters of overhead.
    const value = { s: 'a'.repeat(JSON_FIELD_MAX_BYTES - 8) };
    expect(JSON.stringify(value).length).toBe(JSON_FIELD_MAX_BYTES);
    expect(jsonFieldValueError(value)).toBeNull();
  });

  it('rejects a value one byte over 256 KB', () => {
    const value = { s: 'a'.repeat(JSON_FIELD_MAX_BYTES - 7) };
    expect(jsonFieldValueError(value)).toBe(SIZE);
  });

  it('measures size in UTF-8 bytes, not characters', () => {
    // ~100k characters but ~300k bytes ('€' is 3 bytes in UTF-8).
    const value = { s: '€'.repeat(100000) };
    expect(JSON.stringify(value).length).toBeLessThan(JSON_FIELD_MAX_BYTES);
    expect(jsonFieldValueError(value)).toBe(SIZE);
  });
});
