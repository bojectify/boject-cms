import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport, type RunMetadata } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'render.fixtures', 'raw.json');

function minimalMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
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
    mode: 'read-only',
    seedSize: null,
    seedDeterministicSeed: null,
    partial: false,
    partialFailureSource: null,
    ...overrides,
  };
}

describe('renderReport', () => {
  it('writes summary.md, metadata.json, and metrics.csv', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata(),
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
      runMetadata: minimalMetadata({
        fields: { list: 'articleList', filter: null, relation: null },
        scenarios: [
          { name: 'graphql-flat', outcome: 'partial', shapesRun: ['bare'] },
        ],
        partial: true,
      }),
    });
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.partial).toBe(true);
    expect(meta.fields.filter).toBeNull();
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('partial');
    // skip-shape banner
    expect(md).toMatch(/filtered.*shape.*skipped/i);
  });

  it('handles empty raw.json (just a newline) without crashing', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const emptyFile = join(out, 'empty.json');
    await writeFile(emptyFile, '\n');
    await renderReport({
      rawJsonPath: emptyFile,
      outDir: out,
      runMetadata: minimalMetadata(),
    });
    const csv = await readFile(join(out, 'metrics.csv'), 'utf8');
    expect(csv).toBe('scenario,page_size,shape,count,p50,p95,p99,error_rate');
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toMatch(/No graphql-flat data captured/);
    expect(md).toMatch(/No graphql-sitemap data captured/);
  });

  it('counts malformed NDJSON lines and surfaces them in summary.md', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const corrupted = join(out, 'corrupted.json');
    // Two valid points + one truncated line
    await writeFile(
      corrupted,
      [
        '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-06T14:32:00Z","value":1.0,"tags":{"scenario":"flat","shape":"bare"}}}',
        '{"type":"Point","metric":"http_req_dur', // truncated
        '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-06T14:32:00Z","value":2.0,"tags":{"scenario":"flat","shape":"bare"}}}',
      ].join('\n')
    );
    await renderReport({
      rawJsonPath: corrupted,
      outDir: out,
      runMetadata: minimalMetadata(),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toMatch(/1 malformed line/);
  });

  it('reports schemaVersion 2 in metadata.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata(),
    });
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.schemaVersion).toBe(2);
  });

  it('CSV error_rate is a fractional number not a percentage string', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata(),
    });
    const csv = await readFile(join(out, 'metrics.csv'), 'utf8');
    expect(csv).not.toMatch(/%/);
    // Expect the trailing column to look like a 4-decimal fraction
    expect(csv).toMatch(/0\.0000/);
  });

  it('omits the Run status section for seed-direct non-partial runs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-direct' }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Run status');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.mode).toBe('seed-direct');
  });

  it('renders the seed-http mode banner for seed-http non-partial runs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-http' }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('operator seeded via REST');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.mode).toBe('seed-http');
  });

  it('renders the read-only mode banner for read-only non-partial runs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'read-only' }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('Read-only run');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.mode).toBe('read-only');
  });

  it('renders the reset partial-source banner', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        partial: true,
        partialFailureSource: 'reset',
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('perf-DB reset failed');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.partialFailureSource).toBe('reset');
  });

  it('renders the seed partial-source banner', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        partial: true,
        partialFailureSource: 'seed',
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('seed step failed');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.partialFailureSource).toBe('seed');
  });

  it('renders the k6 partial-source banner', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        partial: true,
        partialFailureSource: 'k6',
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('k6 exited mid-run');
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.partialFailureSource).toBe('k6');
  });

  it('stacks mode + partial-source banners when both apply', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        mode: 'seed-http',
        partial: true,
        partialFailureSource: 'seed',
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('operator seeded via REST');
    expect(md).toContain('seed step failed');
  });

  it('round-trips mode + seedSize + seedDeterministicSeed in metadata.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        mode: 'seed-direct',
        seedSize: 10000,
        seedDeterministicSeed: 7,
      }),
    });
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.mode).toBe('seed-direct');
    expect(meta.seedSize).toBe(10000);
    expect(meta.seedDeterministicSeed).toBe(7);
  });
});
