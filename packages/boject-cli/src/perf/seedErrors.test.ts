import { describe, it, expect } from 'vitest';
import {
  SEED_DUPLICATE_THRESHOLD,
  SeedMostlyDuplicateError,
} from './seedErrors.js';

describe('SeedMostlyDuplicateError', () => {
  it('stores inserted, skipped, and total as public fields', () => {
    const err = new SeedMostlyDuplicateError(8, 2, 10);
    expect(err.inserted).toBe(8);
    expect(err.skipped).toBe(2);
    expect(err.total).toBe(10);
  });

  it('message includes the rounded percentage, the mint hint, and the reset hint', () => {
    const err = new SeedMostlyDuplicateError(8, 2, 10);
    expect(err.message).toContain('20%');
    expect(err.message).toContain('--seed <n>');
    expect(err.message).toContain('boject perf reset --database-url');
    expect(err.message).toContain('see #184');
  });

  it('has name === "SeedMostlyDuplicateError"', () => {
    const err = new SeedMostlyDuplicateError(1, 9, 10);
    expect(err.name).toBe('SeedMostlyDuplicateError');
  });

  it('pins SEED_DUPLICATE_THRESHOLD to 0.5', () => {
    expect(SEED_DUPLICATE_THRESHOLD).toBe(0.5);
  });
});
