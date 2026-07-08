import { describe, expect, it } from 'vitest';
import { normalizeExtends } from './types';

describe('normalizeExtends', () => {
  it('returns [] for null/undefined', () => {
    expect(normalizeExtends(null)).toEqual([]);
    expect(normalizeExtends(undefined)).toEqual([]);
  });
  it('wraps a string in a one-element array', () => {
    expect(normalizeExtends('base')).toEqual(['base']);
  });
  it('returns an array as-is', () => {
    expect(normalizeExtends(['web-base', 'taxonomy'])).toEqual([
      'web-base',
      'taxonomy',
    ]);
  });
});
