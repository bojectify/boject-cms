import { describe, expect, it } from 'vitest';
import { rng } from './prng.js';

describe('rng', () => {
  it('produces deterministic output for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different output for different seeds', () => {
    const a = rng(1);
    const b = rng(2);
    expect(a()).not.toBe(b());
  });

  it('substitutes 1 for a zero seed (xorshift fixed point)', () => {
    const a = rng(0);
    const b = rng(1);
    expect(a()).toBe(b());
  });

  it('returns numbers in [0, 1)', () => {
    const a = rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
