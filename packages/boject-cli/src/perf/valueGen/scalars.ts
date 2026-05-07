import { intInRange, pickN, pickOne } from '../prng.js';
import { LOREM } from './lorem.js';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateEntryTitle(opts: {
  rand: () => number;
  index: number;
}): string {
  const wordCount = intInRange(3, 6, opts.rand);
  const words = pickN(LOREM, wordCount, opts.rand).map(titleCase).join(' ');
  return `${words} #${opts.index}`;
}

/**
 * Slugifies the title and appends the index, separated by a hyphen.
 * Always uniqueness-safe per index. The output may contain redundant
 * trailing digits if the input title ends in a number — that's accepted
 * for perf-seed slugs (uniqueness > readability).
 */
export function generateSlug(opts: {
  entryTitle: string;
  index: number;
}): string {
  const base = opts.entryTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${opts.index}`;
}

export function generateText(opts: {
  rand: () => number;
  unique: boolean;
  index: number;
  seenValues?: Set<string>;
}): string {
  const value = pickN(LOREM, intInRange(4, 10, opts.rand), opts.rand).join(' ');
  if (opts.unique && opts.seenValues) {
    if (opts.seenValues.has(value)) {
      const deduplicated = `${value}-${opts.index}`;
      opts.seenValues.add(deduplicated);
      return deduplicated;
    }
    opts.seenValues.add(value);
  }
  return value;
}

export function generateTextarea(opts: { rand: () => number }): string {
  const paragraphCount = intInRange(1, 3, opts.rand);
  const paragraphs: string[] = [];
  for (let i = 0; i < paragraphCount; i++) {
    paragraphs.push(
      pickN(LOREM, intInRange(40, 80, opts.rand), opts.rand).join(' ')
    );
  }
  return paragraphs.join('\n\n');
}

export function generateNumber(opts: {
  rand: () => number;
  unique: boolean;
  index: number;
}): number {
  if (opts.unique) {
    // Collision-free by construction: each index gets its own 100K bucket
    return opts.index * 100_000 + intInRange(0, 99_999, opts.rand);
  }
  return intInRange(0, 999_999, opts.rand);
}

export function generateBoolean(opts: { rand: () => number }): boolean {
  return opts.rand() < 0.5;
}

/**
 * Returns an ISO-8601 string in [window.from, window.to).
 * The upper bound is exclusive (rand() is half-open).
 */
export function generateDatetime(opts: {
  rand: () => number;
  window: { from: Date; to: Date };
}): string {
  const span = opts.window.to.getTime() - opts.window.from.getTime();
  const ts = opts.window.from.getTime() + Math.floor(opts.rand() * span);
  return new Date(ts).toISOString();
}

export function generateSelect(opts: {
  rand: () => number;
  choices: string[];
}): string {
  if (opts.choices.length === 0) {
    throw new Error(
      'SELECT field requires options.choices — refusing to synthesise an empty value'
    );
  }
  return pickOne(opts.choices, opts.rand);
}
