import { describe, expect, it } from 'vitest';
import { generateRichtext } from './richtext-fixture';

describe('generateRichtext', () => {
  it('produces ProseMirror JSON with doc type and content', () => {
    const doc = generateRichtext(1);
    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
    expect(doc.content!.length).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = generateRichtext(42);
    const b = generateRichtext(42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different output for different seeds', () => {
    const a = generateRichtext(1);
    const b = generateRichtext(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('output serialises to approximately 5KB across the full seed range', () => {
    // Sampled across seeds 1..1000: min 4198, max 5482, p50 4794.
    // Tighter than the original 3500..7500 to catch drift without admitting
    // the under-sized docs the loose bounds previously tolerated.
    const sizes: number[] = [];
    for (let i = 1; i <= 1000; i++) {
      sizes.push(JSON.stringify(generateRichtext(i)).length);
    }
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    expect(min).toBeGreaterThan(4000);
    expect(max).toBeLessThan(6000);
  });
});
