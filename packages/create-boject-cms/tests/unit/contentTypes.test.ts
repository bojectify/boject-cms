import { describe, expect, it } from 'vitest';
import { renderContentTypesBundle } from '../../src/templates/contentTypes.js';

describe('renderContentTypesBundle', () => {
  it('returns the empty bundle stub for the "none" starter', () => {
    const out = renderContentTypesBundle({ starter: 'none' });
    expect(out.kind).toBe('content');
    if (out.kind !== 'content') throw new Error('unreachable');
    const parsed = JSON.parse(out.content);
    expect(parsed.version).toBe(2);
    expect(parsed.portable).toBe(true);
    expect(parsed.contentTypes).toEqual([]);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.exportedAt).toMatch(/T.*Z$/);
  });

  it('returns a copy directive for non-none starters', () => {
    for (const starter of ['base', 'sport', 'rugby'] as const) {
      const out = renderContentTypesBundle({ starter });
      expect(out).toEqual({
        kind: 'copy',
        sourceFilename: `${starter}.boject.json`,
      });
    }
  });
});
