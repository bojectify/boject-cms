/**
 * Seeded xorshift32 PRNG — deterministic across Node versions and platforms.
 * Returns floats in [0, 1) with ~3-decimal granularity (sufficient for
 * lorem-style synthesis; not cryptographic).
 */
export function rng(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
}

export function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(rand() * arr.length)]!);
  }
  return out;
}

export function pickOne<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

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

export function intInRange(
  min: number,
  max: number,
  rand: () => number
): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
