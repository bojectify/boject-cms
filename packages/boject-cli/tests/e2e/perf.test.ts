import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', '..', 'dist', 'index.js');
const URL_BASE = process.env.PERF_E2E_URL ?? 'http://localhost:4000';
const API_KEY =
  process.env.PERF_E2E_API_KEY ?? 'boject_perf_key_for_load_tests_only';
const CONTENT_TYPE = process.env.PERF_E2E_CONTENT_TYPE ?? 'PerfArticle';

function k6OnPath(): boolean {
  const r = spawnSync('k6', ['version'], { stdio: 'ignore' });
  return r.status === 0;
}

async function cmsReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${URL_BASE}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function perfApiKeyValid(): Promise<boolean> {
  try {
    const r = await fetch(`${URL_BASE}/api/schema/export`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

describe('boject perf — e2e', () => {
  let canRun = false;
  beforeAll(async () => {
    canRun = k6OnPath() && (await cmsReachable()) && (await perfApiKeyValid());
  });

  it('check passes against a populated dev CMS', async () => {
    if (!canRun) {
      console.log(
        'Skipping: requires k6 on PATH and CMS dev server reachable.'
      );
      return;
    }
    const r = spawnSync(
      process.execPath,
      [
        CLI,
        'perf',
        'check',
        '--url',
        URL_BASE,
        '--content-type',
        CONTENT_TYPE,
        '--api-key',
        API_KEY,
      ],
      { encoding: 'utf8' }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Preflight OK/);
  }, 30_000);

  it('scenario graphql-sitemap produces a report', async () => {
    if (!canRun) {
      console.log(
        'Skipping: requires k6 on PATH and CMS dev server reachable.'
      );
      return;
    }
    const out = await mkdtemp(join(tmpdir(), 'boject-perf-e2e-'));
    const r = spawnSync(
      process.execPath,
      [
        CLI,
        'perf',
        'scenario',
        'graphql-sitemap',
        '--url',
        URL_BASE,
        '--content-type',
        CONTENT_TYPE,
        '--api-key',
        API_KEY,
        '--out',
        out,
        '--read-only',
        '--yes',
      ],
      { encoding: 'utf8', timeout: 120_000 }
    );
    expect(r.status).toBe(0);
    // Find the timestamped run dir.
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(out);
    expect(entries.length).toBe(1);
    const md = await readFile(join(out, entries[0]!, 'summary.md'), 'utf8');
    expect(md).toContain(URL_BASE.replace(/^https?:\/\//, ''));
  }, 180_000);
});
