import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderContentTypesBundle } from '../../src/templates/contentTypes.js';
import { starterNames } from '../../src/starters.js';

const REPO_STARTERS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'starters'
);
const STARTERS = starterNames(REPO_STARTERS);

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
    for (const starter of STARTERS) {
      const out = renderContentTypesBundle({ starter });
      expect(out).toEqual({
        kind: 'copy',
        sourceFilename: `${starter}.boject.json`,
      });
    }
  });
});
