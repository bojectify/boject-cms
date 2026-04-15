// scripts/build-starters/drift.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './build';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function normalize(content: string): string {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  parsed.exportedAt = '';
  return JSON.stringify(parsed, null, 2) + '\n';
}

describe('starter outputs are up to date', () => {
  it('re-building from committed overlays produces equivalent output', async () => {
    const projectRoot = resolve(__dirname, '..', '..');
    const starters = join(projectRoot, 'starters');
    const tmp = mkdtempSync(join(tmpdir(), 'starters-drift-'));
    cpSync(starters, tmp, { recursive: true });

    await buildAll(tmp);

    for (const name of ['sport', 'rugby']) {
      const committed = readFileSync(
        join(starters, `${name}.boject.json`),
        'utf8'
      );
      const rebuilt = readFileSync(join(tmp, `${name}.boject.json`), 'utf8');
      expect(normalize(rebuilt)).toBe(normalize(committed));
    }
  });
});
