import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaClient } from '../../apps/cms/generated/prisma/client.ts';
import { loadNodeConfig } from '../lib/config-node.ts';
import { resetPerfDb } from '../seed/reset.ts';
import { seedPerfData } from '../seed/bulk-insert.ts';

export type Step =
  | { kind: 'reset' }
  | { kind: 'seed'; size: number }
  | {
      kind: 'scenario';
      name: 'graphql-sitemap' | 'graphql-flat' | 'rest-crud-cycle';
      size: number;
      env: Record<string, string>;
    };

export interface PlanInput {
  sizes: number[];
  pageSizes: number[];
  vusLevels: number[];
}

const FLAT_WAYPOINT = 30000;
const FLAT_SHAPES = ['bare', 'filtered', 'relation'];

export function planSweep(input: PlanInput): Step[] {
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
    env: { PERF_CRUD_N: String(process.env.PERF_CRUD_N ?? '10000') },
  });
  return steps;
}

export interface RunDeps {
  plan: Step[];
  reset: () => Promise<void>;
  seed: (size: number) => Promise<void>;
  scenario: (name: string, env: Record<string, string>) => Promise<void>;
  render: () => Promise<void>;
}

export async function runSweep(deps: RunDeps): Promise<void> {
  for (const step of deps.plan) {
    if (step.kind === 'reset') await deps.reset();
    else if (step.kind === 'seed') await deps.seed(step.size);
    else if (step.kind === 'scenario') await deps.scenario(step.name, step.env);
  }
  await deps.render();
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = (process.env.PERF_SIZES ?? '1000,10000,30000,100000')
    .split(',')
    .map((s) => Number(s.trim()));
  const pageSizes = (process.env.PERF_PAGE_SIZES ?? '100,500,1000')
    .split(',')
    .map((s) => Number(s.trim()));
  const vusLevels = (process.env.PERF_VUS_LEVELS ?? '1,5,20')
    .split(',')
    .map((s) => Number(s.trim()));

  const plan = planSweep({ sizes, pageSizes, vusLevels });
  const cfg = loadNodeConfig();
  const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  const date = new Date().toISOString().slice(0, 10);
  const runId = `${date}-${gitSha}`;
  const reportDir = resolve('reports', runId);
  mkdirSync(reportDir, { recursive: true });

  const rawPath = resolve(reportDir, 'raw.json');

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
      const prisma = new PrismaClient({
        datasourceUrl: cfg.perfDatabaseUrl,
      });
      try {
        await seedPerfData({ prisma, articleCount: size });
      } finally {
        await prisma.$disconnect();
      }
    },
    scenario: async (name, env) => {
      const result = spawnSync(
        'k6',
        ['run', '--out', `json=${rawPath}`, resolve('scenarios', `${name}.ts`)],
        {
          stdio: 'inherit',
          env: { ...process.env, ...env, PERF_BASE_URL: cfg.baseUrl },
        }
      );
      if (result.status !== 0) {
        throw new Error(`scenario ${name} exited with ${result.status}`);
      }
    },
    render: async () => {
      spawnSync('tsx', ['scripts/render-report.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PERF_RAW_PATH: rawPath },
      });
    },
  });

  console.log(`[perf:sweep] wrote ${reportDir}`);
}
