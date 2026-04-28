import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseRawJson,
  parseRawDir,
  computeScenarioStats,
  percentile,
  renderPlots,
  renderSummaryMd,
  toCsv,
  type RawPoint,
} from './render-report';

const fixture = readFileSync(
  resolve(__dirname, 'render-report.fixtures/tiny-raw.json'),
  'utf8'
);

describe('parseRawJson', () => {
  it('parses NDJSON into an array of point records', () => {
    const points = parseRawJson(fixture);
    expect(points).toHaveLength(6);
    expect(points[0]!.metric).toBe('http_req_duration');
  });
});

describe('computeScenarioStats', () => {
  it('groups by (scenario, page_size, shape) and computes percentiles', () => {
    const points = parseRawJson(fixture);
    const stats = computeScenarioStats(points);
    const sitemap100 = stats.find(
      (s) => s.scenario === 'sitemap' && s.pageSize === '100'
    )!;
    expect(sitemap100.count).toBe(3);
    expect(sitemap100.shape).toBe('-');
    expect(sitemap100.p50).toBeCloseTo(120.5, 1);
    expect(sitemap100.p99).toBeCloseTo(310.8, 1);
    expect(sitemap100.errorRate).toBe(0);
  });

  it('splits flat scenario into one row per shape', () => {
    // Without per-shape splitting the bare/filtered/relation flat queries
    // collapse into a single row and the JSONB-index evidence (#25) is
    // invisible in metrics.csv. Regression test that the split happens.
    const mk = (shape: string, value: number): RawPoint => ({
      metric: 'http_req_duration',
      type: 'Point',
      data: {
        time: '2026-04-28T00:00:00Z',
        value,
        tags: { scenario: 'flat', shape },
      },
    });
    const points: RawPoint[] = [
      mk('bare', 10),
      mk('bare', 20),
      mk('filtered', 30),
      mk('filtered', 40),
      mk('relation', 50),
    ];
    const stats = computeScenarioStats(points);
    const flat = stats.filter((s) => s.scenario === 'flat');
    expect(flat).toHaveLength(3);
    const shapes = flat.map((s) => s.shape).sort();
    expect(shapes).toEqual(['bare', 'filtered', 'relation']);
    expect(flat.find((s) => s.shape === 'bare')!.count).toBe(2);
    expect(flat.find((s) => s.shape === 'filtered')!.count).toBe(2);
    expect(flat.find((s) => s.shape === 'relation')!.count).toBe(1);
  });
});

describe('renderSummaryMd', () => {
  it('produces markdown with headline numbers and scenario sections', () => {
    const points = parseRawJson(fixture);
    const md = renderSummaryMd({
      gitSha: 'abc1234',
      date: '2026-04-21',
      stats: computeScenarioStats(points),
    });
    expect(md).toContain('# Load test report — 2026-04-21 (git: abc1234)');
    expect(md).toContain('## Scenario 1A');
    expect(md).toContain('p99');
  });

  it('uses page_size column for sitemap and shape column for flat', () => {
    const stats = [
      {
        scenario: 'sitemap',
        pageSize: '500',
        shape: '-',
        count: 10,
        p50: 7,
        p95: 11,
        p99: 13,
        errorRate: 0,
      },
      {
        scenario: 'flat',
        pageSize: '-',
        shape: 'bare',
        count: 100,
        p50: 1,
        p95: 5,
        p99: 9,
        errorRate: 0,
      },
      {
        scenario: 'flat',
        pageSize: '-',
        shape: 'filtered',
        count: 100,
        p50: 2,
        p95: 8,
        p99: 14,
        errorRate: 0,
      },
    ];
    const md = renderSummaryMd({ gitSha: 'a', date: 'd', stats });
    // Sitemap section advertises page_size; flat section advertises shape.
    expect(md).toMatch(/## Scenario 1A[\s\S]*?\| page_size \|/);
    expect(md).toMatch(/## Scenario 1B[\s\S]*?\| shape \|/);
    // Both flat shapes should appear as separate rows.
    expect(md).toMatch(/\| bare \| 100 \|/);
    expect(md).toMatch(/\| filtered \| 100 \|/);
  });
});

describe('percentile', () => {
  it('uses nearest-rank on a 20-sample series — distinguishes p95 from max', () => {
    // [10, 20, ..., 200] — values map directly to "1-indexed rank × 10".
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    // p50: rank = ceil(0.5*20) = 10 → idx 9 → 100
    expect(percentile(sorted, 0.5)).toBe(100);
    // p95: rank = ceil(0.95*20) = 19 → idx 18 → 190 (NOT 200, which the
    // old `floor(0.95*20)=19 → idx 19 → 200` formula returned).
    expect(percentile(sorted, 0.95)).toBe(190);
    // p99: rank = ceil(0.99*20) = 20 → idx 19 → 200
    expect(percentile(sorted, 0.99)).toBe(200);
  });

  it('returns 0 for an empty sample set', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('clamps to the max index when p × n exceeds the array', () => {
    expect(percentile([1, 2, 3], 1.5)).toBe(3);
  });
});

describe('computeScenarioStats — large group', () => {
  it('reports nearest-rank p95 across a 20-sample group', () => {
    const points: RawPoint[] = Array.from({ length: 20 }, (_, i) => ({
      metric: 'http_req_duration',
      type: 'Point',
      data: {
        time: '2026-04-21T10:00:00Z',
        value: (i + 1) * 10,
        tags: { scenario: 'sitemap', page_size: '500' },
      },
    }));
    const stats = computeScenarioStats(points);
    const sitemap500 = stats.find(
      (s) => s.scenario === 'sitemap' && s.pageSize === '500'
    )!;
    expect(sitemap500.p50).toBe(100);
    expect(sitemap500.p95).toBe(190);
    expect(sitemap500.p99).toBe(200);
  });
});

describe('empty inputs', () => {
  it('parseRawJson returns [] for an empty string', () => {
    expect(parseRawJson('')).toEqual([]);
  });

  it('parseRawJson skips blank/whitespace-only lines', () => {
    expect(parseRawJson('\n  \n\n')).toEqual([]);
  });

  it('computeScenarioStats returns [] when there are no points', () => {
    expect(computeScenarioStats([])).toEqual([]);
  });

  it('renderSummaryMd produces a valid skeleton when stats is empty', () => {
    const md = renderSummaryMd({
      gitSha: 'abc1234',
      date: '2026-04-21',
      stats: [],
    });
    expect(md).toContain('# Load test report — 2026-04-21 (git: abc1234)');
    expect(md).toContain('## Scenario 1A');
    expect(md).toContain('Scenarios captured: 0');
    expect(md).toContain('Total durations recorded: 0');
  });

  it('toCsv emits just the header row when stats is empty', () => {
    expect(toCsv([])).toBe(
      'scenario,page_size,shape,count,p50,p95,p99,error_rate'
    );
  });
});

describe('parseRawDir', () => {
  it('parses raw*.json files in sort order, ignoring others', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-render-'));
    writeFileSync(
      join(dir, 'raw-001-graphql-sitemap.json'),
      '{"metric":"http_req_duration","type":"Point","data":{"time":"t","value":1,"tags":{"scenario":"sitemap"}}}\n'
    );
    writeFileSync(
      join(dir, 'raw-002-graphql-flat.json'),
      '{"metric":"http_req_duration","type":"Point","data":{"time":"t","value":2,"tags":{"scenario":"flat"}}}\n'
    );
    writeFileSync(join(dir, 'summary.md'), '# ignored');
    const points = parseRawDir(dir);
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.data.tags.scenario)).toEqual([
      'sitemap',
      'flat',
    ]);
  });

  it('parses each file independently — never concatenates into one string', () => {
    // Regression for "RangeError: Invalid string length" on full sweeps.
    // Each file is read + parsed in turn so we never hold more than one
    // file's text at a time. Asserting both files contributed proves the
    // streaming aggregation works without resorting to Array.join.
    const dir = mkdtempSync(join(tmpdir(), 'perf-render-stream-'));
    writeFileSync(
      join(dir, 'raw-001.json'),
      '{"metric":"http_req_duration","type":"Point","data":{"time":"t","value":10,"tags":{"scenario":"sitemap","page_size":"100"}}}\n'.repeat(
        3
      )
    );
    writeFileSync(
      join(dir, 'raw-002.json'),
      '{"metric":"http_req_duration","type":"Point","data":{"time":"t","value":20,"tags":{"scenario":"sitemap","page_size":"100"}}}\n'.repeat(
        2
      )
    );
    const points = parseRawDir(dir);
    expect(points).toHaveLength(5);
    expect(points.filter((p) => p.data.value === 10)).toHaveLength(3);
    expect(points.filter((p) => p.data.value === 20)).toHaveLength(2);
  });

  it('throws when the directory has no matching files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-render-empty-'));
    expect(() => parseRawDir(dir)).toThrow(/No raw\*\.json files/);
  });
});

describe('renderPlots', () => {
  it('produces a PNG buffer for sitemap latency by page size', async () => {
    const stats = [
      {
        scenario: 'sitemap',
        pageSize: '100',
        shape: '-',
        count: 10,
        p50: 50,
        p95: 120,
        p99: 300,
        errorRate: 0,
      },
      {
        scenario: 'sitemap',
        pageSize: '500',
        shape: '-',
        count: 10,
        p50: 80,
        p95: 150,
        p99: 380,
        errorRate: 0,
      },
    ];
    const png = await renderPlots(stats);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(500);
    // PNG magic bytes — proves a real image was emitted, not just any Buffer.
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});

describe('toCsv', () => {
  it('emits one row per scenario group with header (incl. shape)', () => {
    const points = parseRawJson(fixture);
    const csv = toCsv(computeScenarioStats(points));
    expect(csv.split('\n')[0]).toBe(
      'scenario,page_size,shape,count,p50,p95,p99,error_rate'
    );
    expect(csv.split('\n').length).toBeGreaterThan(2);
  });
});
