import { describe, expect, it } from 'vitest';
import { rng } from '../prng.js';
import {
  generateEntryTitle,
  generateSlug,
  generateText,
  generateTextarea,
  generateNumber,
  generateBoolean,
  generateDatetime,
  generateSelect,
} from './scalars.js';

describe('valueGen scalars', () => {
  it('generateEntryTitle is unique by index suffix', () => {
    const a = generateEntryTitle({ rand: rng(1), index: 0 });
    const b = generateEntryTitle({ rand: rng(1), index: 1 });
    expect(a).not.toBe(b);
    expect(a).toMatch(/#0$/);
    expect(b).toMatch(/#1$/);
  });

  it('generateSlug slugifies the title and appends the index', () => {
    const a = generateSlug({ entryTitle: 'My Post', index: 0 });
    const b = generateSlug({ entryTitle: 'My Post', index: 1 });
    expect(a).toBe('my-post-0');
    expect(b).toBe('my-post-1');
  });

  it('generateSlug accepts redundant trailing digits when the title is from generateEntryTitle', () => {
    // generateEntryTitle returns "Words #N" which slugifies to "words--n"
    // (the # is dropped, leaving the surrounding spaces). The leading
    // /-+/g collapse + trim handles the empty-segment cleanup; we then
    // append the canonical -<index>. The duplicate -<n>-<n> tail is
    // accepted for perf seeding.
    const a = generateSlug({ entryTitle: 'My Post #5', index: 5 });
    expect(a).toBe('my-post-5-5');
  });

  it('generateSlug strips leading and trailing hyphens before appending', () => {
    const a = generateSlug({ entryTitle: '-- Hello --', index: 0 });
    expect(a).toBe('hello-0');
  });

  it('generateText returns a 4-10 word phrase', () => {
    const v = generateText({ rand: rng(1), unique: false, index: 0 });
    expect(typeof v).toBe('string');
    const words = v.split(' ').length;
    expect(words).toBeGreaterThanOrEqual(4);
    expect(words).toBeLessThanOrEqual(10);
  });

  it('generateText with unique=true appends -<index> when value collides with seenValues', () => {
    // Run once with rng(99) to discover the value it produces, then pre-seed
    // a fresh seenValues with that value to force a collision on a second call.
    const probe = generateText({ rand: rng(99), unique: false, index: 0 });
    const seen = new Set<string>([probe]);
    const collision = generateText({
      rand: rng(99),
      unique: true,
      index: 7,
      seenValues: seen,
    });
    expect(collision).toBe(`${probe}-7`);
    expect(seen.has(`${probe}-7`)).toBe(true);
  });

  it('generateText is deterministic for the same seed', () => {
    const a = generateText({ rand: rng(123), unique: false, index: 0 });
    const b = generateText({ rand: rng(123), unique: false, index: 0 });
    expect(a).toBe(b);
  });

  it('generateTextarea returns 1-3 paragraphs joined by \\n\\n', () => {
    const v = generateTextarea({ rand: rng(1) });
    const paragraphs = v.split('\n\n');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs.length).toBeLessThanOrEqual(3);
  });

  it('generateNumber unique uses index*100000 base (collision-free)', () => {
    const a = generateNumber({ rand: rng(1), unique: true, index: 0 });
    const b = generateNumber({ rand: rng(1), unique: true, index: 1 });
    expect(b - a).toBeGreaterThanOrEqual(100_000);
  });

  it('generateNumber unique stays inside its index bucket on extreme rand values', () => {
    // rand() = 0 → minimum within the bucket
    const min = generateNumber({ rand: () => 0, unique: true, index: 5 });
    expect(min).toBe(500_000);
    // rand() ≈ 1 → maximum within the bucket (must NOT cross into bucket 6)
    const near1 = () => 0.999_999_999;
    const max = generateNumber({ rand: near1, unique: true, index: 5 });
    expect(max).toBeGreaterThanOrEqual(500_000);
    expect(max).toBeLessThan(600_000);
  });

  it('generateBoolean returns both values across many draws', () => {
    // Draw 200 booleans from a single seeded rng. xorshift32's first output
    // for sequential seeds happens to skew, so we walk one stream to sample
    // a fair distribution. Tolerance is generous — we just need to catch
    // "always true" / "always false" regressions.
    const rand = rng(1);
    let trues = 0;
    let falses = 0;
    for (let i = 0; i < 200; i++) {
      const v = generateBoolean({ rand });
      if (v) trues++;
      else falses++;
    }
    expect(trues).toBeGreaterThan(0);
    expect(falses).toBeGreaterThan(0);
  });

  it('generateDatetime returns ISO-8601 inside the window', () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date('2024-12-31T23:59:59Z');
    const v = generateDatetime({ rand: rng(1), window: { from, to } });
    const d = new Date(v);
    expect(d >= from).toBe(true);
    expect(d <= to).toBe(true);
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generateSelect picks from choices', () => {
    const v = generateSelect({ rand: rng(1), choices: ['a', 'b', 'c'] });
    expect(['a', 'b', 'c']).toContain(v);
  });

  it('generateSelect throws on empty choices', () => {
    expect(() => generateSelect({ rand: rng(1), choices: [] })).toThrow(
      /choices/i
    );
  });
});
