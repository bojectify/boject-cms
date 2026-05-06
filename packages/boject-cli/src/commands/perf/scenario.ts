import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runPreflight } from '../../perf/preflight.js';
import { runK6 } from '../../perf/runK6.js';
import { renderReport, type RunMetadata } from '../../perf/render.js';
import { confirmHeavyRun } from '../../perf/confirm.js';
import { sanitiseUrl } from '../../perf/sanitise.js';
import { defaultK6Available, defaultFetchHealth } from '../../perf/runtime.js';
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
  duration?: string;
  stages?: number[];
}

export interface PerfScenarioParams {
  cwd: string;
  apiKey: string | undefined;
  flags: PerfScenarioFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
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

async function k6Version(): Promise<string> {
  return new Promise((res) => {
    const child = spawn('k6', ['version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    child.stdout.on('data', (b: Buffer) => {
      buf += b.toString();
    });
    child.on('error', () => res('unknown'));
    child.on('close', () => {
      const m = buf.match(/k6 v([\d.]+)/);
      res(m ? m[1]! : 'unknown');
    });
  });
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
}> {
  try {
    const c = await loadProjectConfig(cwd);
    return {
      url: c.config.cms.url,
      contentType: c.config.perf?.contentType,
      filterField: c.config.perf?.filterField,
      relationField: c.config.perf?.relationField,
      out: c.config.perf?.out,
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
      'Error: rest-crud-cycle requires seed mode and ships in #171. This CLI only supports read-only scenarios (graphql-flat, graphql-sitemap).'
    );
    return { exitCode: 3 };
  }
  if (name !== 'graphql-flat' && name !== 'graphql-sitemap') {
    params.stderr(
      `Error: unknown scenario "${name}". Valid: graphql-flat, graphql-sitemap.`
    );
    return { exitCode: 3 };
  }

  const v = await resolveAndValidate(params);
  if (!v.ok) return { exitCode: v.exitCode };
  const resolved = v.resolved;

  const preflightResult = await runPreflight({
    url: resolved.url,
    apiKey: resolved.apiKey,
    contentTypeIdentifier: resolved.contentType,
    filterFieldOverride: resolved.filterField,
    relationFieldOverride: resolved.relationField,
    k6Available: defaultK6Available,
    fetchHealth: defaultFetchHealth,
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

  const outDir = join(resolve(params.cwd, resolved.out), timestampDir());
  await mkdir(outDir, { recursive: true });

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
  if (flags.duration) baseEnv.PERF_DURATION = flags.duration;
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

  const k6Ver = await k6Version();
  let combinedExit: 0 | 1 = 0;
  let rawJsonPath = '';

  for (const shape of shapesToRun) {
    const env: Record<string, string> = { ...baseEnv };
    if (name === 'graphql-flat') env.PERF_QUERY_SHAPE = shape;

    const r = await runK6({
      scenarioFile: scenarioPath,
      env,
      apiKey: resolved.apiKey,
      outDir,
      stdout: params.stdout,
      stderr: params.stderr,
    });
    if (!r.ok) {
      params.stderr(`Error: ${r.error}`);
      combinedExit = 1;
      continue;
    }
    rawJsonPath = r.rawJsonPath;
    if (r.exitCode !== 0) combinedExit = 1;
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
      duration: flags.duration ?? '180s',
      stages: flags.stages ?? [50, 100, 250, 500, 1000, 2000],
    },
    partial: combinedExit !== 0,
  };

  if (rawJsonPath) {
    await renderReport({ rawJsonPath, outDir, runMetadata: meta });
    params.stdout(`Report written to ${sanitiseUrl(outDir)}`);
  }
  return { exitCode: combinedExit };
}
