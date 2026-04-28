import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseRawJson,
  computeScenarioStats,
  loadRawFromDir,
  percentile,
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
  it('groups by scenario+page_size and computes percentiles', () => {
    const points = parseRawJson(fixture);
    const stats = computeScenarioStats(points);
    const sitemap100 = stats.find(
      (s) => s.scenario === 'sitemap' && s.pageSize === '100'
    )!;
    expect(sitemap100.count).toBe(3);
    expect(sitemap100.p50).toBeCloseTo(120.5, 1);
    expect(sitemap100.p99).toBeCloseTo(310.8, 1);
    expect(sitemap100.errorRate).toBe(0);
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
    expect(toCsv([])).toBe('scenario,page_size,count,p50,p95,p99,error_rate');
  });
});

describe('loadRawFromDir', () => {
  it('reads and concatenates raw*.json files in sort order, ignoring others', () => {
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
    const concatenated = loadRawFromDir(dir);
    const points = parseRawJson(concatenated);
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.data.tags.scenario)).toEqual([
      'sitemap',
      'flat',
    ]);
  });

  it('throws when the directory has no matching files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-render-empty-'));
    expect(() => loadRawFromDir(dir)).toThrow(/No raw\*\.json files/);
  });
});

describe('toCsv', () => {
  it('emits one row per scenario group with header', () => {
    const points = parseRawJson(fixture);
    const csv = toCsv(computeScenarioStats(points));
    expect(csv.split('\n')[0]).toBe(
      'scenario,page_size,count,p50,p95,p99,error_rate'
    );
    expect(csv.split('\n').length).toBeGreaterThan(2);
  });
});
