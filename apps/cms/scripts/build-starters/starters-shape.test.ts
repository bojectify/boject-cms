import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../content-bundle/validate';

const here = new URL('../../../../starters/', import.meta.url).pathname;
const modulesDir = join(here, 'src', 'modules');

const topLevelBundleFiles = readdirSync(here).filter((f) =>
  f.endsWith('.boject.json')
);
const moduleBundleFiles = safeReaddir(modulesDir)
  .filter((f) => f.endsWith('.boject.json'))
  .map((f) => join('src', 'modules', f));
const bundleFiles = [...topLevelBundleFiles, ...moduleBundleFiles];

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

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
