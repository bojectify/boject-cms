import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRawJson,
  computeScenarioStats,
  renderSummaryMd,
  toCsv,
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
