import { describe, expect, it } from 'vitest';
import {
  rng,
  pickN,
  pickOne,
  sampleWithoutReplacement,
  intInRange,
} from './prng.js';

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

  it('produces a stable known sequence for seed=42 (regression guard)', () => {
    const r = rng(42);
    const first5 = Array.from({ length: 5 }, () => r());
    // These values pin the algorithm + the [0,1) conversion.
    // If this test fails, the PRNG output has shifted — anything downstream
    // that committed snapshots based on this PRNG will need to be regenerated.
    expect(first5).toMatchInlineSnapshot(`
      [
        0.002643892541527748,
        0.660311977379024,
        0.11095708678476512,
        0.8493769019842148,
        0.8754393914714456,
      ]
    `);
  });
});

describe('pickOne', () => {
  it('picks an element from the array', () => {
    const r = rng(1);
    expect([1, 2, 3]).toContain(pickOne([1, 2, 3], r));
  });

  it('is deterministic for the same seed', () => {
    const a = pickOne([1, 2, 3, 4, 5], rng(7));
    const b = pickOne([1, 2, 3, 4, 5], rng(7));
    expect(a).toBe(b);
  });

  it('throws on empty input', () => {
    expect(() => pickOne([], rng(1))).toThrow(/empty/);
  });
});

describe('pickN', () => {
  it('returns an array of the requested length', () => {
    expect(pickN([1, 2, 3], 5, rng(1))).toHaveLength(5);
  });

  it('is deterministic for the same seed', () => {
    expect(pickN([1, 2, 3, 4], 4, rng(2))).toEqual(
      pickN([1, 2, 3, 4], 4, rng(2))
    );
  });

  it('returns empty array when n=0 even on empty input', () => {
    expect(pickN([], 0, rng(1))).toEqual([]);
  });

  it('throws when n>0 and input is empty', () => {
    expect(() => pickN([], 1, rng(1))).toThrow(/empty/);
  });
});

describe('sampleWithoutReplacement', () => {
  it('returns distinct items', () => {
    const out = sampleWithoutReplacement([1, 2, 3, 4, 5], 3, rng(1));
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns a copy of the input when n >= length, not a reference', () => {
    const input = [1, 2, 3];
    const out = sampleWithoutReplacement(input, 5, rng(1));
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
    out[0] = 99;
    expect(input[0]).toBe(1);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    sampleWithoutReplacement(input, 3, rng(1));
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic', () => {
    const a = sampleWithoutReplacement([1, 2, 3, 4, 5], 3, rng(9));
    const b = sampleWithoutReplacement([1, 2, 3, 4, 5], 3, rng(9));
    expect(a).toEqual(b);
  });
});

describe('intInRange', () => {
  it('returns an integer in the inclusive range [min, max]', () => {
    const r = rng(1);
    for (let i = 0; i < 100; i++) {
      const v = intInRange(3, 7, r);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('handles min === max', () => {
    expect(intInRange(5, 5, rng(1))).toBe(5);
  });

  it('reaches the upper bound (with enough samples)', () => {
    let sawMax = false;
    const r = rng(1);
    for (let i = 0; i < 1000; i++) {
      if (intInRange(0, 4, r) === 4) {
        sawMax = true;
        break;
      }
    }
    expect(sawMax).toBe(true);
  });
});
