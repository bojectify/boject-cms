import { intInRange, pickN, pickOne } from '../prng.js';

const LOREM = (
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim ' +
  'veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint ' +
  'occaecat cupidatat non proident sunt in culpa qui officia deserunt ' +
  'mollit anim id est laborum Sed ut perspiciatis unde omnis iste natus ' +
  'error sit voluptatem accusantium doloremque laudantium totam rem aperiam'
).split(' ');

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

export function generateSlug(opts: {
  entryTitle: string;
  index: number;
}): string {
  const base = opts.entryTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  // Strip a trailing -<n> if entryTitle's #N suffix produced one, then append fresh
  const stripped = base.replace(/-\d+$/, '');
  return `${stripped}-${opts.index}`;
}

export function generateText(opts: {
  rand: () => number;
  unique: boolean;
  index: number;
  seenValues?: Set<string>;
  /** Test hook — bypass random word selection when set */
  forcedValue?: string;
}): string {
  const value =
    opts.forcedValue ??
    pickN(LOREM, intInRange(4, 10, opts.rand), opts.rand).join(' ');
  if (opts.unique && opts.seenValues) {
    if (opts.seenValues.has(value)) {
      const broken = `${value}-${opts.index}`;
      opts.seenValues.add(broken);
      return broken;
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
