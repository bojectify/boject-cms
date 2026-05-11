import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMode } from './runMode.js';
import {
  computeConnectionStats,
  readSamplesIfPresent,
  renderConnectionPanel,
} from './renderConnectionPanel.js';

export interface RunMetadata {
  perfCalibratedAt: string;
  cliVersion: string;
  k6Version: string;
  targetHost: string; // already sanitised — no userinfo
  targetScheme: 'http' | 'https';
  contentType: string;
  fields: {
    list: string;
    filter: string | null;
    relation: string | null;
  };
  scenarios: Array<{
    name: 'graphql-flat' | 'graphql-sitemap';
    outcome: 'completed' | 'partial' | 'skipped';
    shapesRun?: string[];
  }>;
  intensity: { targetRps: number; duration: string; stages: number[] };
  mode: RunMode;
  seedSize: number | null;
  seedDeterministicSeed: number | null;
  partial: boolean;
  partialFailureSource: 'reset' | 'seed' | 'k6' | null;
}

export interface RenderParams {
  rawJsonPath: string;
  outDir: string;
  runMetadata: RunMetadata;
  pgSamplesCsvPath?: string;
}

interface RawPoint {
  type: string;
  metric: string;
  data: { time: string; value: number; tags: Record<string, string> };
}

interface ScenarioStats {
  scenario: string;
  pageSize: string;
  shape: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)]!;
}

interface ParseResult {
  points: RawPoint[];
  malformedCount: number;
}

function parseRawJson(raw: string): ParseResult {
  const points: RawPoint[] = [];
  let malformedCount = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as RawPoint;
      if (parsed.type === 'Point') points.push(parsed);
    } catch {
      malformedCount++;
    }
  }
  return { points, malformedCount };
}

function compute(points: RawPoint[]): ScenarioStats[] {
  const groups = new Map<string, number[]>();
  const failGroups = new Map<string, { total: number; failed: number }>();
  for (const p of points) {
    const scenario = p.data.tags.scenario ?? 'unknown';
    const pageSize = p.data.tags.page_size ?? '-';
    const shape = p.data.tags.shape ?? '-';
    const key = `${scenario}|${pageSize}|${shape}`;
    if (p.metric === 'http_req_duration') {
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push(p.data.value);
    } else if (p.metric === 'http_req_failed') {
      let g = failGroups.get(key);
      if (!g) {
        g = { total: 0, failed: 0 };
        failGroups.set(key, g);
      }
      g.total++;
      if (p.data.value === 1) g.failed++;
    }
  }
  return Array.from(groups.entries()).map(([key, values]) => {
    const [scenario, pageSize, shape] = key.split('|') as [
      string,
      string,
      string,
    ];
    const sorted = [...values].sort((a, b) => a - b);
    const fg = failGroups.get(key);
    return {
      scenario,
      pageSize,
      shape,
      count: values.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      errorRate: fg && fg.total > 0 ? fg.failed / fg.total : 0,
    };
  });
}

function fmtMs(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function flatTable(stats: ScenarioStats[]): string {
  const rows = stats
    .filter((s) => s.scenario === 'flat')
    .map(
      (s) =>
        `| ${s.shape} | ${s.count} | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${fmtMs(s.p99)} | ${fmtPct(s.errorRate)} |`
    );
  if (rows.length === 0)
    return '_No graphql-flat data captured (scenario skipped or partial)._';
  return [
    '| shape    | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |',
    '| -------- | ----- | -------- | -------- | -------- | ------ |',
    ...rows,
  ].join('\n');
}

function sitemapTable(stats: ScenarioStats[]): string {
  const rows = stats
    .filter((s) => s.scenario === 'sitemap')
    .map(
      (s) =>
        `| ${s.pageSize} | ${s.count} | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${fmtMs(s.p99)} | ${fmtPct(s.errorRate)} |`
    );
  if (rows.length === 0)
    return '_No graphql-sitemap data captured (scenario skipped or partial)._';
  return [
    '| page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |',
    '| --------- | ----- | -------- | -------- | -------- | ------ |',
    ...rows,
  ].join('\n');
}

function toCsv(stats: ScenarioStats[]): string {
  const header = 'scenario,page_size,shape,count,p50,p95,p99,error_rate';
  const rows = stats.map(
    (s) =>
      `${s.scenario},${s.pageSize},${s.shape},${s.count},${fmtMs(s.p50)},${fmtMs(s.p95)},${fmtMs(s.p99)},${s.errorRate.toFixed(4)}`
  );
  return [header, ...rows].join('\n');
}

function buildModeBanner(mode: RunMode): string | null {
  switch (mode) {
    case 'seed-direct':
      return null;
    case 'seed-http':
      return (
        'DB-side metrics unavailable — operator seeded via REST and ' +
        'has no DB access from this run.'
      );
    case 'read-only':
      return (
        "Read-only run — DB-side metrics unavailable. Check your CMS host's " +
        'database dashboards for connection-pool and lock data.'
      );
  }
}

function buildPartialBanner(
  source: RunMetadata['partialFailureSource']
): string | null {
  switch (source) {
    case 'reset':
      return '**Run aborted before k6 started — perf-DB reset failed.** See logs for the underlying error.';
    case 'seed':
      return '**Run aborted before k6 started — seed step failed.** See logs for the underlying error.';
    case 'k6':
      return '**Run incomplete — k6 exited mid-run.** Some scenarios captured partial data; treat with care.';
    case null:
      return null;
  }
}

function buildSummary(
  meta: RunMetadata,
  stats: ScenarioStats[],
  malformedCount: number,
  connectionPanel: string | null
): string {
  const flatScenario = meta.scenarios.find((s) => s.name === 'graphql-flat');
  const heavyBanner = flatScenario
    ? `**Heavy load run** — peak ${meta.intensity.targetRps} RPS sustained over ${meta.intensity.duration}. Target should be a perf-clone, not production.`
    : '';

  const skipFiltered = meta.fields.filter === null;
  const skipRelation = meta.fields.relation === null;

  const skipBanners: string[] = [];
  if (skipFiltered)
    skipBanners.push(
      `_filtered shape skipped — no DATETIME field on ${meta.contentType}._`
    );
  if (skipRelation)
    skipBanners.push(
      `_relation shape skipped — no single-target RELATION field on ${meta.contentType}._`
    );

  const modeBanner = buildModeBanner(meta.mode);
  const partialBanner = buildPartialBanner(meta.partialFailureSource);
  const banners = [modeBanner, partialBanner].filter(
    (s): s is string => s !== null
  );
  const runStatusSection =
    banners.length > 0 ? `## Run status\n\n${banners.join('\n\n')}\n` : null;

  const lines: Array<string | null> = [
    `# Load test report — ${meta.contentType}`,
    '',
    `- perfCalibratedAt: ${meta.perfCalibratedAt}`,
    `- target: ${meta.targetScheme}://${meta.targetHost}`,
    `- CLI: @boject/cli ${meta.cliVersion} | k6 ${meta.k6Version}`,
    meta.partial ? '- run status: **partial** (k6 exited mid-run)' : null,
    malformedCount > 0
      ? `- raw.json had ${malformedCount} malformed line(s) (skipped)`
      : null,
    '',
    runStatusSection,
    connectionPanel ? `${connectionPanel}\n` : null,
    heavyBanner ? `## Run shape\n\n${heavyBanner}\n` : null,
    skipBanners.length > 0 ? `${skipBanners.join('\n')}\n` : null,
    '## Scenario 1A — GraphQL cursor pagination',
    '',
    sitemapTable(stats),
    '',
    '## Scenario 1B — GraphQL flat RPS',
    '',
    flatTable(stats),
    '',
    '## Run notes',
    '',
    `- Content type: ${meta.contentType}`,
    `- List field: ${meta.fields.list}`,
    `- Filter field: ${meta.fields.filter ?? '(skipped)'}`,
    `- Relation field: ${meta.fields.relation ?? '(skipped)'}`,
    `- Datasets: external — operator-provided`,
    `- See \`metrics.csv\` for the raw aggregate rows and \`metadata.json\` for machine-readable run context.`,
    '',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

function buildMetadata(meta: RunMetadata): object {
  return {
    schemaVersion: 2,
    perfCalibratedAt: meta.perfCalibratedAt,
    cliVersion: meta.cliVersion,
    k6Version: meta.k6Version,
    target: { host: meta.targetHost, scheme: meta.targetScheme },
    contentType: meta.contentType,
    fields: meta.fields,
    scenarios: meta.scenarios,
    intensity: meta.intensity,
    mode: meta.mode,
    seedSize: meta.seedSize,
    seedDeterministicSeed: meta.seedDeterministicSeed,
    partial: meta.partial,
    partialFailureSource: meta.partialFailureSource,
  };
}

async function loadConnectionPanel(
  params: RenderParams
): Promise<string | null> {
  if (params.runMetadata.mode !== 'seed-direct') return null;
  if (!params.pgSamplesCsvPath) return null;
  const csv = await readSamplesIfPresent(params.pgSamplesCsvPath);
  if (csv === null) return null;
  const stats = computeConnectionStats(csv);
  if (stats === null) return null;
  return renderConnectionPanel(stats);
}

export async function renderReport(params: RenderParams): Promise<void> {
  await mkdir(params.outDir, { recursive: true });
  const raw = await readFile(params.rawJsonPath, 'utf8');
  const { points, malformedCount } = parseRawJson(raw);
  const stats = compute(points);
  const connectionPanel = await loadConnectionPanel(params);

  const summary = buildSummary(
    params.runMetadata,
    stats,
    malformedCount,
    connectionPanel
  );
  const metadata = buildMetadata(params.runMetadata);
  const csv = toCsv(stats);

  await writeFile(join(params.outDir, 'summary.md'), summary);
  await writeFile(
    join(params.outDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  await writeFile(join(params.outDir, 'metrics.csv'), csv);
}
