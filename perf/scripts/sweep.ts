import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { loadNodeConfig } from '../lib/config-node';
import { resetPerfDb } from '../seed/reset';
import { seedPerfData } from '../seed/bulk-insert';

export type ScenarioName =
  | 'graphql-sitemap'
  | 'graphql-flat'
  | 'rest-crud-cycle';

export type Step =
  | { kind: 'reset' }
  | { kind: 'seed'; size: number }
  | {
      kind: 'scenario';
      name: ScenarioName;
      size: number;
      env: Record<string, string>;
    };

export interface PlanInput {
  sizes: number[];
  pageSizes: number[];
  vusLevels: number[];
  // Number of items per CRUD phase. Optional in PlanInput so callers
  // (and tests) don't have to thread the env through; the CLI block
  // reads PERF_CRUD_N once and passes it in explicitly.
  crudN?: number;
}

const FLAT_WAYPOINT = 30000;
const FLAT_SHAPES = ['bare', 'filtered', 'relation'];
const DEFAULT_CRUD_N = 10000;

export function planSweep(input: PlanInput): Step[] {
  const crudN = input.crudN ?? DEFAULT_CRUD_N;
  const steps: Step[] = [];
  for (const size of input.sizes) {
    steps.push({ kind: 'reset' });
    steps.push({ kind: 'seed', size });
    for (const pageSize of input.pageSizes) {
      for (const vus of input.vusLevels) {
        steps.push({
          kind: 'scenario',
          name: 'graphql-sitemap',
          size,
          env: { PERF_PAGE_SIZE: String(pageSize), PERF_VUS: String(vus) },
        });
      }
    }
    if (size === FLAT_WAYPOINT) {
      for (const shape of FLAT_SHAPES) {
        steps.push({
          kind: 'scenario',
          name: 'graphql-flat',
          size,
          env: { PERF_QUERY_SHAPE: shape },
        });
      }
    }
  }
  // CRUD runs once, independent of sweep sizes
  steps.push({
    kind: 'scenario',
    name: 'rest-crud-cycle',
    size: 0,
    env: { PERF_CRUD_N: String(crudN) },
  });
  return steps;
}

export interface RunDeps {
  plan: Step[];
  reset: () => Promise<void>;
  seed: (size: number) => Promise<void>;
  scenario: (name: ScenarioName, env: Record<string, string>) => Promise<void>;
  render: () => Promise<void>;
}

export async function runSweep(deps: RunDeps): Promise<void> {
  for (const step of deps.plan) {
    switch (step.kind) {
      case 'reset':
        await deps.reset();
        break;
      case 'seed':
        await deps.seed(step.size);
        break;
      case 'scenario':
        await deps.scenario(step.name, step.env);
        break;
      default: {
        // Exhaustiveness: adding a new Step kind triggers a TS error here
        // until this switch is updated.
        const _exhaustive: never = step;
        throw new Error(`Unknown step kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  await deps.render();
}

// Parses a comma-separated list of positive numbers from an env var.
// Throws with the offending raw input rather than letting NaN propagate
// silently into reset+seed (which would happily run with NaN rows).
export function parseSizeList(raw: string, name: string): number[] {
  const parsed = raw.split(',').map((s) => Number(s.trim()));
  if (
    parsed.length === 0 ||
    parsed.some((n) => !Number.isFinite(n) || n <= 0)
  ) {
    throw new Error(
      `Invalid ${name}=${JSON.stringify(raw)} — expected comma-separated positive numbers`
    );
  }
  return parsed;
}

// Builds the env passed to k6 for a single scenario step. Internal-fixture
// field defaults are pinned here so the sweep stays byte-equivalent
// regardless of any drift in the canonical scenario defaults. Per-step env
// wins over the fixture defaults so future per-content-type sweeps can
// override them.
export function buildScenarioEnv(
  parentEnv: NodeJS.ProcessEnv,
  stepEnv: Record<string, string>,
  baseUrl: string
): Record<string, string> {
  return {
    ...(parentEnv as Record<string, string>),
    PERF_LIST_FIELD: 'perfArticleList',
    PERF_FILTER_FIELD: 'publishDate',
    PERF_RELATION_FIELD: 'author',
    ...stepEnv,
    PERF_BASE_URL: baseUrl,
  };
}

export function parsePositiveInt(raw: string, name: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid ${name}=${JSON.stringify(raw)} — expected a positive number`
    );
  }
  return n;
}

// CLI entry — pathToFileURL handles symlinks, spaces in paths, and
// platform path separators. The naked `file://${argv[1]}` form silently
// no-ops in those cases.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const sizes = parseSizeList(
    process.env.PERF_SIZES ?? '1000,10000,30000,100000',
    'PERF_SIZES'
  );
  const pageSizes = parseSizeList(
    process.env.PERF_PAGE_SIZES ?? '100,500,1000',
    'PERF_PAGE_SIZES'
  );
  const vusLevels = parseSizeList(
    process.env.PERF_VUS_LEVELS ?? '1,5,20',
    'PERF_VUS_LEVELS'
  );
  const crudN = parsePositiveInt(
    process.env.PERF_CRUD_N ?? String(DEFAULT_CRUD_N),
    'PERF_CRUD_N'
  );

  const plan = planSweep({ sizes, pageSizes, vusLevels, crudN });
  const cfg = loadNodeConfig();
  const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  const date = new Date().toISOString().slice(0, 10);
  const runId = `${date}-${gitSha}`;

  // Anchor paths to this file's location rather than process.cwd() so the
  // sweep works whether invoked via `pnpm perf:sweep` (cwd=perf/) or any
  // other entry point (cwd=repo root, cwd=temp dir, etc).
  const here = dirname(fileURLToPath(import.meta.url)); // perf/scripts
  const perfRoot = resolve(here, '..'); // perf
  const reportDir = resolve(perfRoot, 'reports', runId);
  mkdirSync(reportDir, { recursive: true });

  // k6 `--out json=<path>` truncates per `k6 run`, so each scenario gets
  // its own file. The renderer concatenates them via PERF_RAW_DIR.
  let scenarioIndex = 0;

  await runSweep({
    plan,
    reset: async () => {
      const client = new Client({ connectionString: cfg.perfDatabaseUrl });
      await client.connect();
      try {
        await resetPerfDb({
          databaseUrl: cfg.perfDatabaseUrl,
          runQuery: async (sql) => {
            await client.query(sql);
          },
        });
      } finally {
        await client.end();
      }
    },
    seed: async (size) => {
      const client = new Client({ connectionString: cfg.perfDatabaseUrl });
      await client.connect();
      try {
        await seedPerfData({ client, articleCount: size });
      } finally {
        await client.end();
      }
    },
    scenario: async (name, env) => {
      const idx = String(scenarioIndex++).padStart(3, '0');
      const envSuffix = Object.entries(env)
        .map(([k, v]) => `${k.replace(/^PERF_/, '').toLowerCase()}=${v}`)
        .join('_');
      const rawPath = resolve(
        reportDir,
        `raw-${idx}-${name}${envSuffix ? `_${envSuffix}` : ''}.json`
      );
      const scenarioPath = resolve(perfRoot, 'scenarios', `${name}.ts`);
      const result = spawnSync(
        'k6',
        ['run', '--out', `json=${rawPath}`, scenarioPath],
        {
          stdio: 'inherit',
          env: buildScenarioEnv(process.env, env, cfg.baseUrl),
        }
      );
      if (result.status !== 0) {
        throw new Error(`scenario ${name} exited with ${result.status}`);
      }
    },
    render: async () => {
      const renderPath = resolve(here, 'render-report.ts');
      const result = spawnSync('tsx', [renderPath], {
        stdio: 'inherit',
        env: { ...process.env, PERF_RAW_DIR: reportDir },
      });
      if (result.status !== 0) {
        throw new Error(`render-report exited with ${result.status}`);
      }
    },
  });

  console.log(`[perf:sweep] wrote ${reportDir}`);
}
