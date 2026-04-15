import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../scripts/content-bundle/validate';

const here = new URL('.', import.meta.url).pathname;

const bundleFiles = readdirSync(here).filter((f) => f.endsWith('.boject.json'));

describe('starters', () => {
  it('finds at least one starter bundle', () => {
    expect(bundleFiles.length).toBeGreaterThan(0);
  });

  it.each(bundleFiles)('%s passes validateBundle', (filename) => {
    const raw = readFileSync(join(here, filename), 'utf8');
    const bundle = JSON.parse(raw);
    const result = validateBundle(bundle);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});
