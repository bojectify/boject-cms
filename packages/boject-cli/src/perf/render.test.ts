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
    partial: false,
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

  it('reports schemaVersion 1 in metadata.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata(),
    });
    const meta = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    expect(meta.schemaVersion).toBe(1);
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
});
