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

  it('generateSlug derives from title and is unique by index', () => {
    const a = generateSlug({ entryTitle: 'My Post #0', index: 0 });
    const b = generateSlug({ entryTitle: 'My Post #1', index: 1 });
    expect(a).toBe('my-post-0');
    expect(b).toBe('my-post-1');
  });

  it('generateText returns a 4-10 word phrase', () => {
    const v = generateText({ rand: rng(1), unique: false, index: 0 });
    expect(typeof v).toBe('string');
    const words = v.split(' ').length;
    expect(words).toBeGreaterThanOrEqual(4);
    expect(words).toBeLessThanOrEqual(10);
  });

  it('generateText with unique=true appends -<index> on collision', () => {
    const seen = new Set<string>();
    seen.add('Lorem ipsum dolor sit'); // pre-seed a collision
    const v = generateText({
      rand: () => 0,
      unique: true,
      index: 5,
      seenValues: seen,
      forcedValue: 'Lorem ipsum dolor sit',
    });
    expect(v).toBe('Lorem ipsum dolor sit-5');
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

  it('generateBoolean returns a boolean', () => {
    const v = generateBoolean({ rand: rng(1) });
    expect(typeof v).toBe('boolean');
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
