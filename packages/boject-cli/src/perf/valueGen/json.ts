import { intInRange } from '../prng.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Synthesised JSON field value (#497): a small letter→letter map shaped like
 * a flembo-cipher key, e.g. `{ "b": "e", "c": "d", "h": "o" }`. Deterministic
 * for a given PRNG stream; 3–5 distinct keys.
 */
export function generateJson(opts: {
  rand: () => number;
}): Record<string, string> {
  const count = intInRange(3, 5, opts.rand);
  const out: Record<string, string> = {};
  while (Object.keys(out).length < count) {
    const k = LETTERS[intInRange(0, LETTERS.length - 1, opts.rand)]!;
    out[k] = LETTERS[intInRange(0, LETTERS.length - 1, opts.rand)]!;
  }
  return out;
}
