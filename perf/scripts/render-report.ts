import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export interface RawPoint {
  metric: string;
  type: string;
  data: {
    time: string;
    value: number;
    tags: Record<string, string>;
  };
}

export function parseRawJson(raw: string): RawPoint[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawPoint)
    .filter((p) => p.type === 'Point');
}

export interface ScenarioStats {
  scenario: string;
  pageSize: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

export function computeScenarioStats(points: RawPoint[]): ScenarioStats[] {
  // Group http_req_duration by scenario+page_size
  const groups = new Map<string, number[]>();
  const failGroups = new Map<string, { total: number; failed: number }>();
  for (const p of points) {
    const scenario = p.data.tags.scenario ?? 'unknown';
    const pageSize = p.data.tags.page_size ?? '-';
    const key = `${scenario}|${pageSize}`;
    if (p.metric === 'http_req_duration') {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p.data.value);
    } else if (p.metric === 'http_req_failed') {
      if (!failGroups.has(key)) failGroups.set(key, { total: 0, failed: 0 });
      const g = failGroups.get(key)!;
      g.total++;
      if (p.data.value === 1) g.failed++;
    }
  }

  return Array.from(groups.entries()).map(([key, values]) => {
    const [scenario, pageSize] = key.split('|') as [string, string];
    const sorted = [...values].sort((a, b) => a - b);
    const fg = failGroups.get(key);
    return {
      scenario,
      pageSize,
      count: values.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      errorRate: fg && fg.total > 0 ? fg.failed / fg.total : 0,
    };
  });
}

export function toCsv(stats: ScenarioStats[]): string {
  const header = 'scenario,page_size,count,p50,p95,p99,error_rate';
  const rows = stats.map((s) =>
    [
      s.scenario,
      s.pageSize,
      s.count,
      s.p50.toFixed(2),
      s.p95.toFixed(2),
      s.p99.toFixed(2),
      s.errorRate.toFixed(4),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

export interface RenderInput {
  gitSha: string;
  date: string;
  stats: ScenarioStats[];
}

export function renderSummaryMd(input: RenderInput): string {
  const sitemap = input.stats.filter((s) => s.scenario === 'sitemap');
  const flat = input.stats.filter((s) => s.scenario === 'flat');
  const crud = input.stats.filter((s) => s.scenario === 'crud');

  const row = (s: ScenarioStats) =>
    `| ${s.scenario} | ${s.pageSize} | ${s.count} | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.p99.toFixed(1)} | ${(s.errorRate * 100).toFixed(2)}% |`;

  const header =
    '| scenario | page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |\n| --- | --- | --- | --- | --- | --- | --- |';

  return [
    `# Load test report — ${input.date} (git: ${input.gitSha})`,
    '',
    '## Environment',
    '- Host: see run metadata file',
    '',
    '## Headline numbers',
    `- Scenarios captured: ${new Set(input.stats.map((s) => s.scenario)).size}`,
    `- Total durations recorded: ${input.stats.reduce((n, s) => n + s.count, 0)}`,
    '',
    '## Scenario 1A — GraphQL cursor pagination',
    header,
    ...sitemap.map(row),
    '',
    '## Scenario 1B — GraphQL flat RPS',
    header,
    ...flat.map(row),
    '',
    '## Scenario 2 — REST CRUD cycle',
    header,
    ...crud.map(row),
    '',
    '## Recommendations for CMS operators',
    '- GraphQL rate limit: fill in after reading scenario 1B soft-break',
    '- Default page size: choose the row in scenario 1A with best drain-time / p99 tradeoff',
    '- JSONB indexing: attach evidence to #25 if filtered queries lag bare queries noticeably',
    '',
    '## Recommendations for consumers',
    '- Page size: align with the operator recommendation',
    '- On 429: honour Retry-After header',
    '',
  ].join('\n');
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const rawPath = process.env.PERF_RAW_PATH ?? 'reports/latest/raw.json';
  const outDir = dirname(rawPath);
  const raw = readFileSync(resolve(rawPath), 'utf8');
  const points = parseRawJson(raw);
  const stats = computeScenarioStats(points);

  const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  const date = new Date().toISOString().slice(0, 10);

  const md = renderSummaryMd({ gitSha, date, stats });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'summary.md'), md);
  writeFileSync(resolve(outDir, 'metrics.csv'), toCsv(stats));
  console.log(`[render-report] wrote ${outDir}/summary.md + metrics.csv`);
}
