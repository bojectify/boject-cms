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

  it('renders the connection panel for seed-direct runs with a valid CSV', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const csvPath = join(out, 'pg-samples.csv');
    await writeFile(
      csvPath,
      [
        'timestamp,total,active,idle,cpu_percent,mem_mb',
        '2026-05-11T00:00:00Z,10,2,8,0,0',
        '2026-05-11T00:00:05Z,20,8,12,0,0',
      ].join('\n')
    );
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-direct' }),
      pgSamplesCsvPath: csvPath,
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('## Database connection pool');
    expect(md).toContain('| peak  | 20 | 8 | 12 |');
    expect(md).toContain('| mean  | 15 | 5 | 10 |');
  });

  it('omits the connection panel when seed-direct run has no pgSamplesCsvPath', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-direct' }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Database connection pool');
  });

  it('omits the connection panel when the pgSamplesCsvPath is missing', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-direct' }),
      pgSamplesCsvPath: join(out, 'does-not-exist.csv'),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Database connection pool');
  });

  it('omits the connection panel when CSV has only a header row', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const csvPath = join(out, 'pg-samples.csv');
    await writeFile(
      csvPath,
      'timestamp,total,active,idle,cpu_percent,mem_mb\n'
    );
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'seed-direct' }),
      pgSamplesCsvPath: csvPath,
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Database connection pool');
  });

  it('omits the connection panel for read-only runs even with a valid CSV', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const csvPath = join(out, 'pg-samples.csv');
    await writeFile(
      csvPath,
      [
        'timestamp,total,active,idle,cpu_percent,mem_mb',
        '2026-05-11T00:00:00Z,10,2,8,0,0',
      ].join('\n')
    );
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({ mode: 'read-only' }),
      pgSamplesCsvPath: csvPath,
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Database connection pool');
  });

  it('emits Scenario 2 section with all four phase rows for a crud run', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const rawPath = join(out, 'crud.json');
    const crudRaw = [
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":25.0,"tags":{"scenario":"crud","phase":"create"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:01Z","value":30.0,"tags":{"scenario":"crud","phase":"create"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:02Z","value":8.0,"tags":{"scenario":"crud","phase":"read"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:03Z","value":11.0,"tags":{"scenario":"crud","phase":"list"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:04Z","value":22.0,"tags":{"scenario":"crud","phase":"delete"}}}',
      '{"type":"Point","metric":"http_req_failed","data":{"time":"2026-05-11T00:00:00Z","value":0,"tags":{"scenario":"crud","phase":"create"}}}',
    ].join('\n');
    await writeFile(rawPath, crudRaw);
    await renderReport({
      rawJsonPath: rawPath,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'rest-crud-cycle', outcome: 'completed' }],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('## Scenario 2 — REST CRUD cycle');
    expect(md).toMatch(/\| create\s+\|/);
    expect(md).toMatch(/\| read\s+\|/);
    expect(md).toMatch(/\| list\s+\|/);
    expect(md).toMatch(/\| delete\s+\|/);
  });

  it('crud table emits only the phases that produced data (partial)', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const rawPath = join(out, 'crud-partial.json');
    const crudRaw = [
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":25.0,"tags":{"scenario":"crud","phase":"create"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:02Z","value":8.0,"tags":{"scenario":"crud","phase":"read"}}}',
    ].join('\n');
    await writeFile(rawPath, crudRaw);
    await renderReport({
      rawJsonPath: rawPath,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'rest-crud-cycle', outcome: 'partial' }],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('## Scenario 2 — REST CRUD cycle');
    expect(md).toMatch(/\| create\s+\|/);
    expect(md).toMatch(/\| read\s+\|/);
    expect(md).not.toMatch(/\| list\s+\|/);
    expect(md).not.toMatch(/\| delete\s+\|/);
  });

  it('omits Scenario 1A and Scenario 2 when only graphql-flat ran', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [
          { name: 'graphql-flat', outcome: 'completed', shapesRun: ['bare'] },
        ],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Scenario 1A');
    expect(md).not.toContain('## Scenario 2');
    expect(md).toContain('## Scenario 1B');
  });

  it('omits Scenario 1B and Scenario 2 when only graphql-sitemap ran', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    await renderReport({
      rawJsonPath: FIXTURE,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'graphql-sitemap', outcome: 'completed' }],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).not.toContain('## Scenario 1B');
    expect(md).not.toContain('## Scenario 2');
    expect(md).toContain('## Scenario 1A');
  });

  it('emits both Scenario 1B and Scenario 2 when flat + crud both present', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const rawPath = join(out, 'mixed.json');
    const mixedRaw = [
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":1.5,"tags":{"scenario":"flat","shape":"bare"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":25.0,"tags":{"scenario":"crud","phase":"create"}}}',
    ].join('\n');
    await writeFile(rawPath, mixedRaw);
    await renderReport({
      rawJsonPath: rawPath,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [
          { name: 'graphql-flat', outcome: 'completed', shapesRun: ['bare'] },
          { name: 'rest-crud-cycle', outcome: 'completed' },
        ],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('## Scenario 1B — GraphQL flat RPS');
    expect(md).toContain('## Scenario 2 — REST CRUD cycle');
    expect(md).not.toContain('## Scenario 1A');
  });

  it('CSV emits crud rows with shape=phase and page_size="-"', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const rawPath = join(out, 'crud-csv.json');
    const crudRaw = [
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":25.0,"tags":{"scenario":"crud","phase":"create"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:02Z","value":8.0,"tags":{"scenario":"crud","phase":"read"}}}',
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:03Z","value":22.0,"tags":{"scenario":"crud","phase":"delete"}}}',
    ].join('\n');
    await writeFile(rawPath, crudRaw);
    await renderReport({
      rawJsonPath: rawPath,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'rest-crud-cycle', outcome: 'completed' }],
      }),
    });
    const csv = await readFile(join(out, 'metrics.csv'), 'utf8');
    expect(csv).toMatch(/^crud,-,create,1,/m);
    expect(csv).toMatch(/^crud,-,read,1,/m);
    expect(csv).toMatch(/^crud,-,delete,1,/m);
  });

  it('CSV header is unchanged when crud rows are present', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const rawPath = join(out, 'crud-header.json');
    const crudRaw =
      '{"type":"Point","metric":"http_req_duration","data":{"time":"2026-05-11T00:00:00Z","value":25.0,"tags":{"scenario":"crud","phase":"create"}}}';
    await writeFile(rawPath, crudRaw);
    await renderReport({
      rawJsonPath: rawPath,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'rest-crud-cycle', outcome: 'completed' }],
      }),
    });
    const csv = await readFile(join(out, 'metrics.csv'), 'utf8');
    expect(csv.split('\n')[0]).toBe(
      'scenario,page_size,shape,count,p50,p95,p99,error_rate'
    );
  });

  it('emits Scenario 2 placeholder when scenarios includes crud but raw is empty', async () => {
    const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
    const emptyFile = join(out, 'empty-crud.json');
    await writeFile(emptyFile, '\n');
    await renderReport({
      rawJsonPath: emptyFile,
      outDir: out,
      runMetadata: minimalMetadata({
        scenarios: [{ name: 'rest-crud-cycle', outcome: 'partial' }],
      }),
    });
    const md = await readFile(join(out, 'summary.md'), 'utf8');
    expect(md).toContain('## Scenario 2 — REST CRUD cycle');
    expect(md).toMatch(/No rest-crud-cycle data captured/);
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

  describe('GraphQL complexity cap suggestion (#122)', () => {
    it('emits the cap block in info mode when currentMaxCost is unset', async () => {
      const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
      await renderReport({
        rawJsonPath: FIXTURE,
        outDir: out,
        runMetadata: minimalMetadata(),
      });
      const md = await readFile(join(out, 'summary.md'), 'utf8');
      expect(md).toContain('## GraphQL complexity cap');
      expect(md).toContain('**Suggested cap:**');
      expect(md).toContain('Compare against your existing');
      expect(md).not.toContain('You could raise to');
      expect(md).not.toContain('exceeds measured sustain');
    });

    it('emits green-light prose when currentMaxCost is below the suggestion', async () => {
      const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
      await renderReport({
        rawJsonPath: FIXTURE,
        outDir: out,
        runMetadata: minimalMetadata(),
        currentMaxCost: 100,
      });
      const md = await readFile(join(out, 'summary.md'), 'utf8');
      expect(md).toContain('## GraphQL complexity cap');
      expect(md).toContain('Your hardware sustained the current cap of 100');
      expect(md).toContain('You could raise to');
    });

    it('emits warning prose when currentMaxCost exceeds the suggestion', async () => {
      const out = await mkdtemp(join(tmpdir(), 'boject-render-'));
      await renderReport({
        rawJsonPath: FIXTURE,
        outDir: out,
        runMetadata: minimalMetadata(),
        currentMaxCost: 99999,
      });
      const md = await readFile(join(out, 'summary.md'), 'utf8');
      expect(md).toContain('## GraphQL complexity cap');
      expect(md).toContain('exceeds measured sustain');
      expect(md).toContain(
        '**Lowering the cap is a breaking change to clients**'
      );
    });
  });
});
