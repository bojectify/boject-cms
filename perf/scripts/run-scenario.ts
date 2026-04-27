import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    out: { type: 'string', default: 'perf/reports/latest/raw.json' },
  },
});

const scenario = positionals[0];
if (!scenario) {
  console.error('Usage: run-scenario <name> [--out path]');
  console.error('  Available: graphql-sitemap, graphql-flat, rest-crud-cycle');
  process.exit(1);
}

const scriptPath = resolve('scenarios', `${scenario}.ts`);
if (!existsSync(scriptPath)) {
  console.error(`Unknown scenario: ${scenario}`);
  process.exit(1);
}

const out = resolve(values.out as string);
const result = spawnSync(
  'k6',
  ['run', '--out', `json=${out}`, scriptPath, ...process.argv.slice(3)],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
