import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight } from '../../perf/preflight.js';
import type { probeContentWriteScope } from '../../perf/probeContentWriteScope.js';
import { runK6 } from '../../perf/runK6.js';
import { renderReport, type RunMetadata } from '../../perf/render.js';
import { confirmHeavyRun } from '../../perf/confirm.js';
import { deriveMode } from '../../perf/runMode.js';
import {
  startPgSampler,
  type PgSamplerHandle,
} from '../../perf/runPgSampler.js';
import { buildPartialMeta } from '../../perf/buildPartialMeta.js';
import { sanitiseUrl } from '../../perf/sanitise.js';
import {
  defaultK6Available,
  defaultK6Version,
  defaultFetchHealth,
} from '../../perf/runtime.js';
import { loadProjectConfig } from '../../config.js';
import { CLI_VERSION } from '../../version.js';

export type PerfScenarioName = 'graphql-flat' | 'graphql-sitemap';
const FLAT_SHAPES = ['bare', 'filtered', 'relation'] as const;

export interface PerfScenarioFlags {
  scenario?: string;
  url?: string;
  apiKey?: string;
  contentType?: string;
  filterField?: string;
  relationField?: string;
  out?: string;
  yes: boolean;
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
  allowDatabase?: string[];
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

export interface PerfScenarioParams {
  cwd: string;
  apiKey: string | undefined;
  flags: PerfScenarioFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Test-only injection seam for the content:write probe. */
  probeContentWrite?: typeof probeContentWriteScope;
  /** Test-only injection seam for the pg-sampler factory. */
  startPgSampler?: typeof startPgSampler;
}

export interface PerfScenarioResult {
  exitCode: 0 | 1 | 2 | 3 | 130;
}

interface ResolvedConfig {
  url: string;
  apiKey: string;
  contentType: string;
  filterField?: string;
  relationField?: string;
  out: string;
}

function resolveScenarioPath(name: PerfScenarioName): string {
  // After tsup bundles, this code lives in dist/index.js. The vendored
  // .ts scenarios sit at dist/vendor/perf/scenarios/. At test time the
  // path is academic — runK6 is mocked, so the file isn't opened.
  const here = fileURLToPath(import.meta.url);
  const distDir = dirname(here);
  return join(distDir, 'vendor', 'perf', 'scenarios', `${name}.ts`);
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

function timestampDir(): string {
  const d = new Date();
  const iso = d
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  const suffix = Math.random().toString(16).slice(2, 6);
  return `${iso}-${suffix}`;
}

async function resolveAndValidate(
  params: PerfScenarioParams
): Promise<
  { ok: true; resolved: ResolvedConfig } | { ok: false; exitCode: 2 | 3 }
> {
  const flags = params.flags;
  const defaults = await loadDefaults(params.cwd, params.stderr);
  const url = flags.url ?? defaults.url;
  const apiKey = flags.apiKey ?? params.apiKey;
  const contentType = flags.contentType ?? defaults.contentType;

  if (!apiKey) {
    params.stderr(
      'Error: API key missing. Set BOJECT_API_KEY or pass --api-key. Mint with `boject apikey create --scopes content:read`.'
    );
    return { ok: false, exitCode: 2 };
  }
  if (!url) {
    params.stderr(
      'Error: --url not provided and no .boject.config.json found.'
    );
    return { ok: false, exitCode: 2 };
  }
  if (!contentType) {
    params.stderr(
      'Error: --content-type is required (or set perf.contentType in .boject.config.json).'
    );
    return { ok: false, exitCode: 3 };
  }
  return {
    ok: true,
    resolved: {
      url,
      apiKey,
      contentType,
      filterField: flags.filterField ?? defaults.filterField,
      relationField: flags.relationField ?? defaults.relationField,
      out: flags.out ?? defaults.out ?? './perf-reports',
    },
  };
}

export async function runPerfScenario(
  params: PerfScenarioParams
): Promise<PerfScenarioResult> {
  const flags = params.flags;
  const name = flags.scenario;
  if (!name) {
    params.stderr(
      'Error: scenario name required (graphql-flat | graphql-sitemap).'
    );
    return { exitCode: 3 };
  }
  if (name === 'rest-crud-cycle') {
    params.stderr(
      'Error: rest-crud-cycle scenario is not yet implemented in the CLI. Supported scenarios: graphql-flat, graphql-sitemap.'
    );
    return { exitCode: 3 };
  }
  if (name !== 'graphql-flat' && name !== 'graphql-sitemap') {
    params.stderr(
      `Error: unknown scenario "${name}". Valid: graphql-flat, graphql-sitemap.`
    );
    return { exitCode: 3 };
  }

  const configDefaults = await loadDefaults(params.cwd, params.stderr);

  // CLI flags win; config fills the gap.
  const effectiveDatabaseUrl =
    flags.databaseUrl ?? configDefaults.perfDatabaseUrl;

  // #159: pre-flight requires either --read-only or a seed transport.
  if (!flags.readOnly && !effectiveDatabaseUrl && !flags.httpSeed) {
    params.stderr(
      'boject perf scenario without --read-only must provide a seed transport ' +
        '(--database-url for SQL or --http-seed for HTTP). ' +
        'Read-only mode is now opt-in via --read-only.'
    );
    return { exitCode: 2 };
  }

  // Hoisted above reset/seed (#181) so the partial-render-on-failure path
  // can write metadata.json into outDir from the reset/seed catch blocks.
  // resolveAndValidate is pure (no side effects); the hoist preserves its
  // early-return semantics for missing apiKey/url/contentType.
  const v = await resolveAndValidate(params);
  if (!v.ok) return { exitCode: v.exitCode };
  const resolved = v.resolved;

  const outDir = join(resolve(params.cwd, resolved.out), timestampDir());
  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    // mkdir failed → we have nowhere to render to. Don't attempt a
    // partial write; the existing exit-2 contract is correct here.
    params.stderr(
      `Error: cannot create output directory ${outDir}: ${(err as Error).message}. Try --out <writable-dir>.`
    );
    return { exitCode: 2 };
  }

  let seedResult: { inserted: number } | null = null;
  if (!flags.readOnly) {
    if (flags.reset && effectiveDatabaseUrl) {
      try {
        const { runPerfReset } = await import('./reset.js');
        await runPerfReset({
          databaseUrl: effectiveDatabaseUrl,
          yes: flags.yes,
          allowDatabase: flags.allowDatabase,
        });
      } catch (err) {
        params.stderr(`${(err as Error).message}\n`);
        await writeFile(join(outDir, 'raw.json'), '');
        await renderReport({
          rawJsonPath: join(outDir, 'raw.json'),
          outDir,
          runMetadata: buildPartialMeta({
            mode: deriveMode({
              readOnly: flags.readOnly,
              httpSeed: flags.httpSeed,
              databaseUrl: effectiveDatabaseUrl,
            }),
            contentType: resolved.contentType,
            url: resolved.url,
            cliVersion: CLI_VERSION,
            k6Version: await defaultK6Version(),
            partialFailureSource: 'reset',
            seedSize: null,
            seedDeterministicSeed: flags.seed ?? configDefaults.seed ?? null,
          }),
        });
        return { exitCode: 1 };
      }
    }
    const seedContentType = flags.contentType ?? configDefaults.contentType;
    if (!seedContentType) {
      params.stderr('Seed-then-run requires --content-type');
      return { exitCode: 2 };
    }
    try {
      const { runPerfSeed } = await import('./seed.js');
      seedResult = await runPerfSeed({
        contentType: seedContentType,
        size: flags.size ?? configDefaults.size ?? 10000,
        seed: flags.seed ?? configDefaults.seed,
        databaseUrl: effectiveDatabaseUrl,
        httpSeed: flags.httpSeed,
        bundle: flags.bundle,
        url: resolved.url,
        apiKey: flags.apiKey ?? params.apiKey,
        concurrency: flags.concurrency,
        allowDatabase: flags.allowDatabase,
        yes: flags.yes,
      });
    } catch (err) {
      params.stderr(`${(err as Error).message}\n`);
      await writeFile(join(outDir, 'raw.json'), '');
      await renderReport({
        rawJsonPath: join(outDir, 'raw.json'),
        outDir,
        runMetadata: buildPartialMeta({
          mode: deriveMode({
            readOnly: flags.readOnly,
            httpSeed: flags.httpSeed,
            databaseUrl: effectiveDatabaseUrl,
          }),
          contentType: resolved.contentType,
          url: resolved.url,
          cliVersion: CLI_VERSION,
          k6Version: await defaultK6Version(),
          partialFailureSource: 'seed',
          seedSize: seedResult?.inserted ?? null,
          seedDeterministicSeed: flags.seed ?? configDefaults.seed ?? null,
        }),
      });
      return { exitCode: 1 };
    }
  }

  const preflightResult = await runPreflight({
    url: resolved.url,
    apiKey: resolved.apiKey,
    contentTypeIdentifier: resolved.contentType,
    filterFieldOverride: resolved.filterField,
    relationFieldOverride: resolved.relationField,
    k6Available: defaultK6Available,
    fetchHealth: defaultFetchHealth,
    requireContentWrite: !flags.readOnly && flags.httpSeed === true,
    probeContentWrite: params.probeContentWrite,
  });

  if (!preflightResult.ok) {
    for (const e of preflightResult.errors) params.stderr(`Error: ${e}`);
    return { exitCode: 2 };
  }
  for (const w of preflightResult.warnings) params.stdout(`Warning: ${w}`);

  // Heavy-run confirm — only for graphql-flat.
  if (name === 'graphql-flat') {
    const targetUrl = new URL(resolved.url);
    const confirmed = await confirmHeavyRun({
      summary: {
        targetHost: targetUrl.host,
        peakRps: flags.targetRps ?? 2000,
        durationSeconds: 180,
        scenarios: [name],
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
  }

  const baseEnv: Record<string, string> = {
    PERF_BASE_URL: resolved.url,
    PERF_API_KEY: resolved.apiKey,
    PERF_LIST_FIELD: preflightResult.fields.listField,
  };
  if (preflightResult.fields.filterField)
    baseEnv.PERF_FILTER_FIELD = preflightResult.fields.filterField;
  if (preflightResult.fields.relationField)
    baseEnv.PERF_RELATION_FIELD = preflightResult.fields.relationField;
  if (flags.targetRps) baseEnv.PERF_TARGET_RPS = String(flags.targetRps);
  if (flags.stages) baseEnv.PERF_STAGES = flags.stages.join(',');

  const scenarioPath = resolveScenarioPath(name);
  const shapesToRun: string[] =
    name === 'graphql-flat'
      ? FLAT_SHAPES.filter((s) => {
          if (s === 'filtered') return preflightResult.fields.filterField;
          if (s === 'relation') return preflightResult.fields.relationField;
          return true;
        })
      : ['-'];

  const k6Ver = await defaultK6Version();
  let combinedExit: 0 | 1 = 0;
  let rawJsonPath = '';
  let successfulShapes = 0;

  // Bracket the k6 spawn(s) with the pg-sampler when running in
  // seed-direct mode. The sampler must be stopped BEFORE renderReport
  // runs so the CSV is fully flushed; the `try/finally` below gives us
  // that ordering — renderReport sits outside both the try and finally.
  const mode = deriveMode({
    readOnly: flags.readOnly,
    httpSeed: flags.httpSeed,
    databaseUrl: effectiveDatabaseUrl,
  });
  const startSampler = params.startPgSampler ?? startPgSampler;
  let samplerHandle: PgSamplerHandle | null = null;
  if (mode === 'seed-direct' && effectiveDatabaseUrl) {
    try {
      samplerHandle = await startSampler({
        databaseUrl: effectiveDatabaseUrl,
        outDir,
      });
    } catch (err) {
      params.stderr(
        `[pg-sampler] failed to start: ${(err as Error).message} — report will omit connection panel.\n`
      );
    }
  }

  try {
    for (const shape of shapesToRun) {
      const env: Record<string, string> = { ...baseEnv };
      if (name === 'graphql-flat') env.PERF_QUERY_SHAPE = shape;

      // For graphql-flat we invoke k6 once per shape against the same outDir,
      // so each invocation must write to a distinct file or it overwrites the
      // previous shape's data. graphql-sitemap is a single invocation — keep
      // the default raw.json filename.
      const rawFilename =
        name === 'graphql-flat' ? `raw-${shape}.json` : 'raw.json';

      const r = await runK6({
        scenarioFile: scenarioPath,
        env,
        apiKey: resolved.apiKey,
        outDir,
        rawFilename,
        stdout: params.stdout,
        stderr: params.stderr,
      });
      if (!r.ok) {
        params.stderr(`Error: ${r.error}`);
        combinedExit = 1;
        continue;
      }
      rawJsonPath = r.rawJsonPath;
      if (r.exitCode === 0) successfulShapes++;
      else combinedExit = 1;
    }
  } finally {
    if (samplerHandle) await samplerHandle.stop();
  }

  if (successfulShapes === 0) {
    params.stderr('Error: all k6 runs failed — no data captured.');
    return { exitCode: 1 };
  }

  // Concatenate per-shape NDJSON files into a single raw.json so the
  // renderer (which expects one combined input) sees every shape's metrics.
  // Sitemap already wrote to raw.json — skip the merge step there.
  if (name === 'graphql-flat') {
    const shapeFiles = shapesToRun.map((s) => join(outDir, `raw-${s}.json`));
    const combined = await Promise.all(
      shapeFiles.map(async (f) => {
        try {
          return await readFile(f, 'utf8');
        } catch {
          // A shape's k6 invocation may have failed before writing the
          // file; skip silently and let the surviving shapes drive the
          // report.
          return '';
        }
      })
    );
    rawJsonPath = join(outDir, 'raw.json');
    await writeFile(rawJsonPath, combined.filter(Boolean).join('\n'));
  }

  const targetUrl = new URL(resolved.url);
  const meta: RunMetadata = {
    perfCalibratedAt: new Date().toISOString(),
    cliVersion: CLI_VERSION,
    k6Version: k6Ver,
    targetHost: targetUrl.host,
    targetScheme: targetUrl.protocol === 'http:' ? 'http' : 'https',
    contentType: resolved.contentType,
    fields: {
      list: preflightResult.fields.listField,
      filter: preflightResult.fields.filterField,
      relation: preflightResult.fields.relationField,
    },
    scenarios: [
      {
        name,
        outcome: combinedExit === 0 ? 'completed' : 'partial',
        ...(name === 'graphql-flat' ? { shapesRun: shapesToRun } : {}),
      },
    ],
    intensity: {
      targetRps: flags.targetRps ?? 2000,
      duration: '180s',
      stages: flags.stages ?? scaleDefaultStages(flags.targetRps ?? 2000),
    },
    mode,
    seedSize: seedResult?.inserted ?? null,
    seedDeterministicSeed: flags.seed ?? configDefaults.seed ?? null,
    partial: combinedExit !== 0,
    partialFailureSource: combinedExit !== 0 ? 'k6' : null,
  };

  if (rawJsonPath) {
    await renderReport({
      rawJsonPath,
      outDir,
      runMetadata: meta,
      pgSamplesCsvPath: samplerHandle?.csvPath,
    });
    params.stdout(`Report written to ${sanitiseUrl(outDir)}`);
  }
  return { exitCode: combinedExit };
}
