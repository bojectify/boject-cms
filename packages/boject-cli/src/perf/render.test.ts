import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'render.fixtures', 'raw.json');

describe('renderReport', () => {
  it('writes summary.md, metadata.json, and metrics.csv', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: {
        perfCalibratedAt: '2026-05-06T14:32:11Z',
        cliVersion: '0.0.1-test',
        k6Version: '0.50.0',
        targetHost: 'cms-staging.example.com',
        targetScheme: 'https',
        contentType: 'Article',
        fields: {
          list: 'articleList',
          filter: 'publishDate',
          relation: 'author',
        },
        scenarios: [
          { name: 'graphql-flat', outcome: 'completed', shapesRun: ['bare'] },
          { name: 'graphql-sitemap', outcome: 'completed' },
        ],
        intensity: {
          targetRps: 2000,
          duration: '180s',
          stages: [50, 100, 250, 500, 1000, 2000],
        },
        partial: false,
      },
    });

    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('perfCalibratedAt: 2026-05-06T14:32:11Z');
    expect(md).toContain('cms-staging.example.com');
    expect(md).toContain('Read-only run');
    expect(md).toContain('Heavy load run');
    expect(md).toMatch(/Scenario 1A.*GraphQL/i);
    expect(md).toMatch(/Scenario 1B.*GraphQL/i);

    const metaRaw = await readFile(join(out, 'metadata.json'), 'utf8');
    const meta = JSON.parse(metaRaw);
    expect(meta.perfCalibratedAt).toBe('2026-05-06T14:32:11Z');
    expect(meta.target.host).toBe('cms-staging.example.com');
    // No api keys, no Authorization headers anywhere.
    expect(metaRaw).not.toMatch(/api[_-]?key/i);
    expect(metaRaw).not.toMatch(/authorization/i);
    expect(metaRaw).not.toMatch(/bearer/i);

    const csv = await readFile(join(out, 'metrics.csv'), 'utf8');
    expect(csv.split('\n')[0]).toBe(
      'scenario,page_size,shape,count,p50,p95,p99,error_rate'
    );
    expect(csv).toContain('flat,-,bare,3,');
    expect(csv).toContain('sitemap,100,-,2,');
  });

  it('marks partial runs and omits API key from output', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: {
        perfCalibratedAt: '2026-05-06T14:32:11Z',
        cliVersion: '0.0.1-test',
        k6Version: '0.50.0',
        targetHost: 'cms-staging.example.com',
        targetScheme: 'https',
        contentType: 'Article',
        fields: { list: 'articleList', filter: null, relation: null },
        scenarios: [
          { name: 'graphql-flat', outcome: 'partial', shapesRun: ['bare'] },
        ],
        intensity: {
          targetRps: 2000,
          duration: '180s',
          stages: [50, 100, 250, 500, 1000, 2000],
        },
        partial: true,
      },
    });
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.partial).toBe(true);
    expect(meta.fields.filter).toBeNull();
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('partial');
    // skip-shape banner
    expect(md).toMatch(/filtered.*shape.*skipped/i);
  });
});
