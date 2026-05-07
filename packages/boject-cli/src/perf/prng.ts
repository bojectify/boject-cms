/**
 * Seeded xorshift32 PRNG — deterministic across Node versions and platforms.
 * Returns floats in [0, 1) using full 32-bit entropy (no modulo bias).
 * Not cryptographic.
 */
export function rng(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** Pick `n` items uniformly with replacement (duplicates allowed). */
export function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  if (n > 0 && arr.length === 0)
    throw new Error('pickN: cannot pick from empty array');
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(rand() * arr.length)]!);
  }
  return out;
}

/** Pick one item uniformly. Throws on empty input. */
export function pickOne<T>(arr: T[], rand: () => number): T {
  if (arr.length === 0) throw new Error('pickOne: array must not be empty');
  return arr[Math.floor(rand() * arr.length)]!;
}

/**
 * Pick up to `n` distinct items uniformly. If `n >= arr.length`, returns a
 * copy of all items. Does not mutate `arr`.
 */
export function sampleWithoutReplacement<T>(
  arr: T[],
  n: number,
  rand: () => number
): T[] {
  if (n >= arr.length) return [...arr];
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * pool.length);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

/** Random integer in [min, max] (both inclusive). */
export function intInRange(
  min: number,
  max: number,
  rand: () => number
): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
