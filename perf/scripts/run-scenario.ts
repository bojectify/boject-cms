import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Args before `--` belong to this wrapper; everything after is forwarded
// verbatim to k6. Splitting here avoids the duplicate-`--out` and
// "scenario name forwarded as a k6 positional" hazards that came from
// walking process.argv with a hardcoded slice index.
const argv = process.argv.slice(2);
const sepIndex = argv.indexOf('--');
const ownArgs = sepIndex === -1 ? argv : argv.slice(0, sepIndex);
const forwardedToK6 = sepIndex === -1 ? [] : argv.slice(sepIndex + 1);

const { values, positionals } = parseArgs({
  args: ownArgs,
  allowPositionals: true,
  strict: false,
  options: {
    out: { type: 'string', default: 'perf/reports/latest/raw.json' },
  },
});

const scenario = positionals[0];
if (!scenario) {
  console.error('Usage: run-scenario <name> [--out path] -- [k6 args...]');
  console.error('  Available: graphql-sitemap, graphql-flat, rest-crud-cycle');
  process.exit(1);
}

const scriptPath = resolve('scenarios', `${scenario}.ts`);
if (!existsSync(scriptPath)) {
  console.error(`Unknown scenario: ${scenario}`);
  process.exit(1);
}

const out = resolve(values.out as string);
mkdirSync(dirname(out), { recursive: true });

const result = spawnSync(
  'k6',
  ['run', '--out', `json=${out}`, scriptPath, ...forwardedToK6],
  { stdio: 'inherit' }
);

if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
  console.error(
    'k6 not found in PATH. Install: https://k6.io/docs/get-started/installation/'
  );
  process.exit(127);
}

if (result.signal) {
  console.error(`k6 terminated by signal: ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
