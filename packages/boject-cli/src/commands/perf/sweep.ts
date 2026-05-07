import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight } from '../../perf/preflight.js';
import { runK6 } from '../../perf/runK6.js';
import { renderReport, type RunMetadata } from '../../perf/render.js';
import { confirmHeavyRun } from '../../perf/confirm.js';
import { sanitiseUrl } from '../../perf/sanitise.js';
import {
  defaultK6Available,
  defaultFetchHealth,
  defaultK6Version,
} from '../../perf/runtime.js';
import { loadProjectConfig } from '../../config.js';
import { CLI_VERSION } from '../../version.js';

const FLAT_SHAPES = ['bare', 'filtered', 'relation'] as const;
const DEFAULT_PAGE_SIZES = [100, 500, 1000];
const DEFAULT_VUS = [1, 5, 20];

export interface PerfSweepFlags {
  url?: string;
  apiKey?: string;
  contentType?: string;
  filterField?: string;
  relationField?: string;
  out?: string;
  yes: boolean;
  pageSizes?: number[];
  vus?: number[];
  targetRps?: number;
  stages?: number[];
  // New (#159) — seed-then-run + read-only opt-in
  readOnly?: boolean;
  databaseUrl?: string;
  httpSeed?: boolean;
  bundle?: string;
  size?: number;
  seed?: number;
  concurrency?: number;
  reset?: boolean;
  allowNonPerfDb?: boolean;
}

// Mirrors the ramp `parseStages()` builds in
// perf/scenarios/graphql-flat.ts when PERF_STAGES is unset — used for
// reporting metadata so the rendered report reflects what k6 actually ran.
function scaleDefaultStages(targetRps: number): number[] {
  return [
    Math.round(targetRps * 0.025),
    Math.round(targetRps * 0.05),
    Math.round(targetRps * 0.125),
    Math.round(targetRps * 0.25),
    Math.round(targetRps * 0.5),
    targetRps,
  ];
}

export interface PerfSweepParams {
  cwd: string;
  apiKey: string | undefined;
  flags: PerfSweepFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface PerfSweepResult {
  exitCode: 0 | 1 | 2 | 3 | 130;
}

function resolveScenarioPath(name: string): string {
  // Mirrors scenario.ts — vendored .ts at dist/vendor/perf/scenarios/.
  const here = fileURLToPath(import.meta.url);
  const distDir = dirname(here);
  return join(distDir, 'vendor', 'perf', 'scenarios', `${name}.ts`);
}

function timestampDir(): string {
  const d = new Date();
  const iso = d
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(16).slice(2, 6);
  return `${iso}-${suffix}`;
}

async function loadDefaults(
  cwd: string,
  stderr: (l: string) => void
): Promise<{
  url?: string;
  contentType?: string;
  filterField?: string;
  relationField?: string;
  out?: string;
  size?: number;
  seed?: number;
  perfDatabaseUrl?: string;
}> {
  try {
    const c = await loadProjectConfig(cwd);
    return {
      url: c.config.cms.url,
      contentType: c.config.perf?.contentType,
      filterField: c.config.perf?.filterField,
      relationField: c.config.perf?.relationField,
      out: c.config.perf?.out,
      size: c.config.perf?.size,
      seed: c.config.perf?.seed,
      perfDatabaseUrl: c.config.perf?.perfDatabaseUrl,
    };
  } catch (err) {
    const message = (err as Error).message;
    if (!message.startsWith('No .boject.config.json found')) {
      stderr(`Warning: ignoring config: ${message}`);
    }
    return {};
  }
}

export async function runPerfSweep(
  params: PerfSweepParams
): Promise<PerfSweepResult> {
  const flags = params.flags;

  const defaults = await loadDefaults(params.cwd, params.stderr);
  const effectiveDatabaseUrl = flags.databaseUrl ?? defaults.perfDatabaseUrl;

  // #159: pre-flight requires either --read-only or a seed transport.
  if (!flags.readOnly && !effectiveDatabaseUrl && !flags.httpSeed) {
    params.stderr(
      'boject perf sweep without --read-only must provide a seed transport ' +
        '(--database-url for SQL or --http-seed for HTTP). ' +
        'Read-only mode is now opt-in via --read-only.'
    );
    return { exitCode: 2 };
  }

  if (!flags.readOnly) {
    if (flags.reset && effectiveDatabaseUrl) {
      try {
        const { runPerfReset } = await import('./reset.js');
        await runPerfReset({
          databaseUrl: effectiveDatabaseUrl,
          yes: flags.yes,
          allowNonPerfDb: flags.allowNonPerfDb,
        });
      } catch (err) {
        params.stderr(`${(err as Error).message}\n`);
        return { exitCode: 1 };
      }
    }
    const seedContentType = flags.contentType ?? defaults.contentType;
    if (!seedContentType) {
      params.stderr('Seed-then-run requires --content-type');
      return { exitCode: 2 };
    }
    try {
      const { runPerfSeed } = await import('./seed.js');
      await runPerfSeed({
        contentType: seedContentType,
        size: flags.size ?? defaults.size ?? 10000,
        seed: flags.seed ?? defaults.seed,
        databaseUrl: effectiveDatabaseUrl,
        httpSeed: flags.httpSeed,
        bundle: flags.bundle,
        url: flags.url ?? defaults.url,
        apiKey: flags.apiKey ?? params.apiKey,
        concurrency: flags.concurrency,
        allowNonPerfDb: flags.allowNonPerfDb,
        yes: flags.yes,
      });
    } catch (err) {
      params.stderr(`${(err as Error).message}\n`);
      return { exitCode: 1 };
    }
  }

  const url = flags.url ?? defaults.url;
  const apiKey = flags.apiKey ?? params.apiKey;
  const contentType = flags.contentType ?? defaults.contentType;

  if (!apiKey) {
    params.stderr(
      'Error: API key missing. Set BOJECT_API_KEY or pass --api-key. Mint with `boject apikey create --scopes content:read`.'
    );
    return { exitCode: 2 };
  }
  if (!url) {
    params.stderr(
      'Error: --url not provided and no .boject.config.json found.'
    );
    return { exitCode: 2 };
  }
  if (!contentType) {
    params.stderr(
      'Error: --content-type is required (or set perf.contentType in .boject.config.json).'
    );
    return { exitCode: 3 };
  }

  const preflightResult = await runPreflight({
    url,
    apiKey,
    contentTypeIdentifier: contentType,
    filterFieldOverride: flags.filterField ?? defaults.filterField,
    relationFieldOverride: flags.relationField ?? defaults.relationField,
    k6Available: defaultK6Available,
    fetchHealth: defaultFetchHealth,
  });
  if (!preflightResult.ok) {
    for (const e of preflightResult.errors) params.stderr(`Error: ${e}`);
    return { exitCode: 2 };
  }
  for (const w of preflightResult.warnings) params.stdout(`Warning: ${w}`);

  const targetUrl = new URL(url);
  const confirmed = await confirmHeavyRun({
    summary: {
      targetHost: targetUrl.host,
      peakRps: flags.targetRps ?? 2000,
      durationSeconds: 180,
      scenarios: ['graphql-flat', 'graphql-sitemap'],
    },
    input: process.stdin,
    stdout: params.stdout,
    yes: flags.yes,
    isTty: process.stdin.isTTY === true,
  });
  if (!confirmed) {
    params.stderr(
      'Aborted by user (or non-TTY without --yes). No data captured.'
    );
    return { exitCode: 130 };
  }

  const outRoot = resolve(
    params.cwd,
    flags.out ?? defaults.out ?? './perf-reports'
  );
  const outDir = join(outRoot, timestampDir());
  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    params.stderr(
      `Error: cannot create output directory ${outDir}: ${(err as Error).message}. Try --out <writable-dir>.`
    );
    return { exitCode: 2 };
  }

  const baseEnv: Record<string, string> = {
    PERF_BASE_URL: url,
    PERF_API_KEY: apiKey,
    PERF_LIST_FIELD: preflightResult.fields.listField,
  };
  if (preflightResult.fields.filterField)
    baseEnv.PERF_FILTER_FIELD = preflightResult.fields.filterField;
  if (preflightResult.fields.relationField)
    baseEnv.PERF_RELATION_FIELD = preflightResult.fields.relationField;
  if (flags.targetRps) baseEnv.PERF_TARGET_RPS = String(flags.targetRps);
  if (flags.stages) baseEnv.PERF_STAGES = flags.stages.join(',');

  const pageSizes = flags.pageSizes ?? DEFAULT_PAGE_SIZES;
  const vusList = flags.vus ?? DEFAULT_VUS;

  const rawFiles: string[] = [];
  let sitemapSuccessful = 0;
  let sitemapTotal = 0;
  let flatSuccessful = 0;

  // Sitemap matrix: page sizes × VU levels.
  for (const pageSize of pageSizes) {
    for (const vus of vusList) {
      sitemapTotal++;
      const env: Record<string, string> = {
        ...baseEnv,
        PERF_PAGE_SIZE: String(pageSize),
        PERF_VUS: String(vus),
      };
      const rawFilename = `raw-sitemap-${pageSize}-${vus}.json`;
      const r = await runK6({
        scenarioFile: resolveScenarioPath('graphql-sitemap'),
        env,
        apiKey,
        outDir,
        rawFilename,
        stdout: params.stdout,
        stderr: params.stderr,
      });
      if (!r.ok) {
        params.stderr(`Error: ${r.error}`);
        continue;
      }
      if (r.exitCode === 0) sitemapSuccessful++;
      rawFiles.push(r.rawJsonPath);
    }
  }

  // Flat shapes — skip those gated by missing introspection results.
  const shapesToRun = FLAT_SHAPES.filter((s) => {
    if (s === 'filtered') return Boolean(preflightResult.fields.filterField);
    if (s === 'relation') return Boolean(preflightResult.fields.relationField);
    return true;
  });
  const flatTotal = shapesToRun.length;
  for (const shape of shapesToRun) {
    const env: Record<string, string> = {
      ...baseEnv,
      PERF_QUERY_SHAPE: shape,
    };
    const rawFilename = `raw-flat-${shape}.json`;
    const r = await runK6({
      scenarioFile: resolveScenarioPath('graphql-flat'),
      env,
      apiKey,
      outDir,
      rawFilename,
      stdout: params.stdout,
      stderr: params.stderr,
    });
    if (!r.ok) {
      params.stderr(`Error: ${r.error}`);
      continue;
    }
    if (r.exitCode === 0) flatSuccessful++;
    rawFiles.push(r.rawJsonPath);
  }

  const successfulRuns = sitemapSuccessful + flatSuccessful;
  if (successfulRuns === 0) {
    params.stderr('Error: all k6 runs failed — no data captured.');
    return { exitCode: 1 };
  }

  // Concatenate per-call NDJSON files into outDir/raw.json so the renderer
  // (which expects a single combined input) sees every run's metrics.
  const combined = await Promise.all(
    rawFiles.map(async (f) => {
      try {
        return await readFile(f, 'utf8');
      } catch {
        // A run may have failed before writing the file; skip silently.
        return '';
      }
    })
  );
  const rawJsonPath = join(outDir, 'raw.json');
  await writeFile(rawJsonPath, combined.filter(Boolean).join('\n'));

  const totalRuns = sitemapTotal + flatTotal;
  const partial = successfulRuns < totalRuns;

  const k6Ver = await defaultK6Version();
  const meta: RunMetadata = {
    perfCalibratedAt: new Date().toISOString(),
    cliVersion: CLI_VERSION,
    k6Version: k6Ver,
    targetHost: targetUrl.host,
    targetScheme: targetUrl.protocol === 'http:' ? 'http' : 'https',
    contentType,
    fields: {
      list: preflightResult.fields.listField,
      filter: preflightResult.fields.filterField,
      relation: preflightResult.fields.relationField,
    },
    scenarios: [
      {
        name: 'graphql-sitemap',
        outcome:
          sitemapTotal > 0 && sitemapSuccessful === sitemapTotal
            ? 'completed'
            : 'partial',
      },
      {
        name: 'graphql-flat',
        outcome:
          flatTotal > 0 && flatSuccessful === flatTotal
            ? 'completed'
            : 'partial',
        shapesRun: [...shapesToRun],
      },
    ],
    intensity: {
      targetRps: flags.targetRps ?? 2000,
      duration: '180s',
      stages: flags.stages ?? scaleDefaultStages(flags.targetRps ?? 2000),
    },
    partial,
  };

  await renderReport({ rawJsonPath, outDir, runMetadata: meta });
  params.stdout(`Sweep report written to ${sanitiseUrl(outDir)}`);
  return { exitCode: partial ? 1 : 0 };
}
