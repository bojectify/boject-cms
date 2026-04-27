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

  it('output serialises to approximately 5KB', () => {
    const size = JSON.stringify(generateRichtext(1)).length;
    expect(size).toBeGreaterThan(3500);
    expect(size).toBeLessThan(7500);
  });
});
