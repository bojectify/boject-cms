import { parseArgs } from 'node:util';
import { runUpgrade, type CommandRunner } from './commands/upgrade.js';
import { runSchemaPull } from './commands/schema/pull.js';
import { runSchemaValidate } from './commands/schema/validate.js';
import { runSchemaApply } from './commands/schema/apply.js';
import { runSchemaCheck } from './commands/schema/check.js';
import { runApikeyCreate } from './commands/apikey/create.js';
import { runApikeyList } from './commands/apikey/list.js';
import { runApikeyRevoke } from './commands/apikey/revoke.js';
import { runPerfCheck } from './commands/perf/check.js';
import { runPerfScenario } from './commands/perf/scenario.js';
import { runPerfSweep } from './commands/perf/sweep.js';
import { runPerfReport } from './commands/perf/report.js';
import { runPerfReset } from './commands/perf/reset.js';
import { runPerfSeed } from './commands/perf/seed.js';
import { spawn } from 'node:child_process';
import { CLI_VERSION } from './version.js';

const USAGE = `Usage: boject <command> [flags]

Commands:
  upgrade            Upgrade the CMS image tag in the current
                     directory's docker-compose.yml.
  schema pull        Fetch schema from a CMS to content-types/schema.boject.json.
  schema validate    Validate a local bundle (no network).
  schema apply       Push a local bundle to a CMS via API.
  schema check       Compare local schema against the live CMS.
  apikey create      Create a new API key.
  apikey list        List API keys.
  apikey revoke      Revoke an API key by prefix.
  perf <command>     Run perf scenarios / sweep / report / check / seed / reset.

Run \`boject <command> --help\` for command-specific flags.
`;

const PERF_USAGE = `Usage: boject perf <command> [flags]

Commands:
  scenario <name>   Run one scenario (graphql-flat | graphql-sitemap).
  sweep             Run all scenarios across the default sweep matrix.
  report            Re-render a previous run.
  check             Preflight verification (k6, target, key, content type, fields).
  seed              Generate + write perf entries (SQL or HTTP transport).
  reset             Truncate the perf content tables in a target DB.

Run \`boject perf <command> --help\` for command-specific flags.
`;

const PERF_CHECK_USAGE = `Usage: boject perf check --content-type <id> [--url <url>] [--filter-field <id>] [--relation-field <id>] [--http-seed]

Verifies: k6 is on PATH, target reachable, API key valid with content:read scope,
content type exists, and DATETIME / single-target RELATION fields can be selected.
Exits 0 on success, 2 on environment problems, 3 on input problems.

Flags:
  --http-seed              Verify the API key carries content:write (use
                           when this run will seed via REST).
`;

const PERF_SCENARIO_USAGE = `Usage: boject perf scenario <name> --content-type <id> [flags]

Scenarios:
  graphql-flat       RPS ramp 50→2000 over 3 minutes (heavy load).
  graphql-sitemap    Cursor pagination drain at varied page sizes / VU levels.
  rest-crud-cycle    Sequential REST CRUD (create/read/update/delete) — mutates target.

Mode (one required):
  --read-only             Skip seeding; run k6 against the existing dataset.
  --database-url <url>    Seed via SQL (writeViaSql) before running k6.
  --http-seed             Seed via REST (writeViaHttp) before running k6.

Common flags:
  --url <url>             Target CMS base URL. Defaults to .boject.config.json.
  --api-key <key>         Bearer token. Defaults to $BOJECT_API_KEY.
  --filter-field <id>     Override DATETIME field for the "filtered" shape.
  --relation-field <id>   Override single-target RELATION field for "relation" shape.
  --out <dir>             Report output dir. Default ./perf-reports/.
  --yes                   Skip the heavy-run confirm prompt (CI-friendly).

Seed-then-run flags (only when --read-only is NOT set):
  --bundle <path>         Local bundle file. Default: GET /api/schema/export.
  --size <n>              Entries to seed. Default 10000.
  --seed <int>            PRNG seed for determinism. Default 1.
  --concurrency <n>       HTTP only. Default 8.
  --reset                 SQL only. Truncate perf tables before seeding.
  --allow-database <name> SQL only. Allow this DB even if it doesn't end
                          in _perf/_staging. Repeatable.
                          ⚠ Reset TRUNCATES all entries — use only
                          for throwaway DBs you can rebuild.

graphql-flat power-user overrides:
  --target-rps <n>        Override peak RPS (default 2000).
  --stages <csv>          Comma-separated RPS stages, e.g. 50,100,500,2000.

rest-crud-cycle overrides:
  --crud-n <n>            Iterations per phase for rest-crud-cycle.
                          Default 10000 (matches canonical).
`;

const PERF_SWEEP_USAGE = `Usage: boject perf sweep --content-type <id> [flags]

Runs both graphql-sitemap (across page sizes × VU levels) and graphql-flat
(across all three query shapes) producing one combined report.

Mode (one required):
  --read-only             Skip seeding; run k6 against the existing dataset.
  --database-url <url>    Seed via SQL (writeViaSql) before running k6.
  --http-seed             Seed via REST (writeViaHttp) before running k6.

Common flags:
  --url <url>             Target CMS base URL.
  --api-key <key>         Bearer token. Defaults to $BOJECT_API_KEY.
  --filter-field <id>     Override DATETIME field for the "filtered" shape.
  --relation-field <id>   Override single-target RELATION for "relation" shape.
  --out <dir>             Report output dir. Default ./perf-reports/.
  --yes                   Skip the heavy-run confirm prompt (CI-friendly).

Seed-then-run flags (only when --read-only is NOT set):
  --bundle <path>         Local bundle file. Default: GET /api/schema/export.
  --size <n>              Entries to seed. Default 10000.
  --seed <int>            PRNG seed for determinism. Default 1.
  --concurrency <n>       HTTP only. Default 8.
  --reset                 SQL only. Truncate perf tables before seeding.
  --allow-database <name> SQL only. Allow this DB even if it doesn't end
                          in _perf/_staging. Repeatable.
                          ⚠ Reset TRUNCATES all entries — use only
                          for throwaway DBs you can rebuild.

Sweep matrix:
  --page-sizes <csv>      Default 100,500,1000.
  --vus <csv>             Default 1,5,20.

graphql-flat power-user overrides:
  --target-rps <n>        Override peak RPS (default 2000).
  --stages <csv>          Comma-separated RPS stages, e.g. 50,100,500,2000.
`;

const PERF_REPORT_USAGE = `Usage: boject perf report [--from <dir>] [--out <dir>]

Re-renders summary.md, metadata.json, and metrics.csv from an existing run.
With no flags, picks the latest run in ./perf-reports/ (or perf.out from
.boject.config.json).

  --from <dir>    Re-render this specific run dir.
  --out <dir>     Override the search root (default ./perf-reports/).
`;

const PERF_SEED_USAGE = `Usage: boject perf seed --content-type <id> [flags]

Required:
  --content-type <id>       Target content type (must exist in the bundle).

Transport (exactly one):
  --database-url <url>      Direct SQL via writeViaSql. DB name must end _perf/_staging.
  --http-seed               REST via writeViaHttp. Uses --url + --api-key.

Bundle source:
  (default)                 GET /api/schema/export via --url + --api-key.
  --bundle <path>           Read from local JSON file (validated).

Common:
  --size <n>                Entries to seed. Default 10000.
  --seed <int>              PRNG seed for determinism. Default 1.
  --concurrency <n>         HTTP only. Default 8.
  --reset                   SQL only. Truncate perf data before seeding.
  --allow-database <name>   SQL only. Allow this DB even if it doesn't end
                            in _perf/_staging. Repeatable.
                            ⚠ Reset TRUNCATES all entries — use only
                            for throwaway DBs you can rebuild.
  --url <url>               CMS base URL.
  --api-key <key>           Defaults to $BOJECT_API_KEY.
  --yes                     Bypass TTY confirmation prompts.
`;

const PERF_RESET_USAGE = `Usage: boject perf reset --database-url <url> [flags]

Truncates the perf-specific content tables in the target database.

Required flags:
  --database-url <url>      Postgres connection string. DB name must end
                            in _perf/_staging unless --allow-database lists it.

Optional flags:
  --allow-database <name>   Allow this DB even if it doesn't end in
                            _perf/_staging. Repeatable.
                            ⚠ Reset TRUNCATES all entries — use only
                            for throwaway DBs you can rebuild.
  --yes                     Skip the TTY confirmation prompt.
`;

const SCHEMA_PULL_USAGE = `Usage: boject schema pull [--out <path>] [--url <url>]

Reads .boject.config.json (walks up from CWD), GETs <cms.url>/api/schema/export,
and writes the response to <schema.path>. Requires BOJECT_API_KEY in env.
`;

const SCHEMA_VALIDATE_USAGE = `Usage: boject schema validate [<path>]

Validates a bundle file's shape and runs the planner against an empty
snapshot to surface cross-reference issues. No network. If <path> is
omitted, falls back to the configured schema.path.
`;

const SCHEMA_APPLY_USAGE = `Usage: boject schema apply [<path>] [--allow-destructive] [--dry-run]

POSTs the bundle to <cms.url>/api/schema/apply. Requires BOJECT_API_KEY.
--dry-run runs the apply server-side but rolls back the transaction.
`;

const SCHEMA_CHECK_USAGE = `Usage: boject schema check

Pulls the live schema and diffs it against the on-disk bundle. Exits 1
on drift. Designed for CI.
`;

const APIKEY_CREATE_USAGE = `Usage: boject apikey create --name <n> --scopes <csv> [--url <url>]

Mints a new API key. Requires BOJECT_API_KEY in env (must have apikey:write scope).
The raw key is printed once; it cannot be retrieved later.

Recognised scopes: content:read, content:write, schema:read, schema:write, apikey:read, apikey:write.

Note: minting a key with apikey:write requires session auth (CMS UI). API-key callers
cannot self-replicate.
`;

const APIKEY_LIST_USAGE = `Usage: boject apikey list [--json] [--url <url>]

Lists API keys. Requires BOJECT_API_KEY in env (must have apikey:read scope).
With --json, emits the raw response for piping to jq.
`;

const APIKEY_REVOKE_USAGE = `Usage: boject apikey revoke <prefix> [--url <url>]

Soft-revokes an API key by its prefix. Requires BOJECT_API_KEY (apikey:write scope).
`;

const nodeRunner: CommandRunner = {
  run(cmd, args, opts) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: 'inherit' });
      child.on('close', (code) => resolve({ status: code }));
    });
  },
};

const stdout = (line: string) => process.stdout.write(`${line}\n`);
const stderr = (line: string) => process.stderr.write(`${line}\n`);

async function dispatchSchema(args: string[]): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE);
    return subcommand ? 0 : 1;
  }

  const apiKey = process.env.BOJECT_API_KEY;

  switch (subcommand) {
    case 'pull': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_PULL_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          out: { type: 'string' },
          url: { type: 'string' },
        },
      });
      const r = await runSchemaPull({
        cwd: process.cwd(),
        apiKey,
        flags: { out: values.out, url: values.url },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'validate': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_VALIDATE_USAGE);
        return 0;
      }
      const { positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {},
      });
      const r = await runSchemaValidate({
        cwd: process.cwd(),
        path: positionals[0],
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'apply': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_APPLY_USAGE);
        return 0;
      }
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          'allow-destructive': { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
          url: { type: 'string' },
        },
      });
      const r = await runSchemaApply({
        cwd: process.cwd(),
        apiKey,
        flags: {
          path: positionals[0],
          url: values.url,
          allowDestructive: values['allow-destructive'] === true,
          dryRun: values['dry-run'] === true,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'check': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_CHECK_USAGE);
        return 0;
      }
      const r = await runSchemaCheck({
        cwd: process.cwd(),
        apiKey,
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    default:
      process.stderr.write(`Unknown schema subcommand: ${subcommand}\n`);
      process.stdout.write(USAGE);
      return 1;
  }
}

async function dispatchApikey(args: string[]): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE);
    return subcommand ? 0 : 1;
  }

  const apiKey = process.env.BOJECT_API_KEY;

  switch (subcommand) {
    case 'create': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(APIKEY_CREATE_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          name: { type: 'string' },
          scopes: { type: 'string' },
          url: { type: 'string' },
        },
      });
      const r = await runApikeyCreate({
        cwd: process.cwd(),
        apiKey,
        flags: {
          name: values.name,
          scopes: values.scopes,
          url: values.url,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'list': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(APIKEY_LIST_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          json: { type: 'boolean', default: false },
          url: { type: 'string' },
        },
      });
      const r = await runApikeyList({
        cwd: process.cwd(),
        apiKey,
        flags: { json: values.json === true, url: values.url },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'revoke': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(APIKEY_REVOKE_USAGE);
        return 0;
      }
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          url: { type: 'string' },
        },
      });
      const r = await runApikeyRevoke({
        cwd: process.cwd(),
        apiKey,
        flags: { prefix: positionals[0], url: values.url },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    default:
      process.stderr.write(`Unknown apikey subcommand: ${subcommand}\n`);
      process.stdout.write(USAGE);
      return 1;
  }
}

async function dispatchPerf(args: string[]): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(PERF_USAGE);
    return subcommand ? 0 : 1;
  }

  const apiKey = process.env.BOJECT_API_KEY;

  switch (subcommand) {
    case 'check': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_CHECK_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          url: { type: 'string' },
          'api-key': { type: 'string' },
          'content-type': { type: 'string' },
          'filter-field': { type: 'string' },
          'relation-field': { type: 'string' },
          'http-seed': { type: 'boolean', default: false },
        },
      });
      const r = await runPerfCheck({
        cwd: process.cwd(),
        apiKey,
        flags: {
          url: values.url,
          apiKey: values['api-key'],
          contentType: values['content-type'],
          filterField: values['filter-field'],
          relationField: values['relation-field'],
          httpSeed: values['http-seed'] === true,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'scenario': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_SCENARIO_USAGE);
        return 0;
      }
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          url: { type: 'string' },
          'api-key': { type: 'string' },
          'content-type': { type: 'string' },
          'filter-field': { type: 'string' },
          'relation-field': { type: 'string' },
          out: { type: 'string' },
          yes: { type: 'boolean', default: false },
          'target-rps': { type: 'string' },
          stages: { type: 'string' },
          'read-only': { type: 'boolean', default: false },
          'database-url': { type: 'string' },
          'http-seed': { type: 'boolean', default: false },
          bundle: { type: 'string' },
          size: { type: 'string' },
          seed: { type: 'string' },
          concurrency: { type: 'string' },
          reset: { type: 'boolean', default: false },
          'allow-database': { type: 'string', multiple: true, default: [] },
          'crud-n': { type: 'string' },
        },
      });
      if (values['crud-n'] !== undefined) {
        const n = Number(values['crud-n']);
        if (!Number.isInteger(n) || n <= 0) {
          process.stderr.write(
            `Error: --crud-n must be a positive integer, got "${values['crud-n']}".\n`
          );
          process.exit(2);
        }
      }
      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey,
        flags: {
          scenario: positionals[0],
          url: values.url,
          apiKey: values['api-key'],
          contentType: values['content-type'],
          filterField: values['filter-field'],
          relationField: values['relation-field'],
          out: values.out,
          yes: values.yes === true,
          targetRps: values['target-rps']
            ? Number(values['target-rps'])
            : undefined,
          stages: values.stages
            ? values.stages.split(',').map((s) => Number(s.trim()))
            : undefined,
          readOnly: values['read-only'] === true,
          databaseUrl: values['database-url'],
          httpSeed: values['http-seed'] === true,
          bundle: values.bundle,
          size: values.size ? Number(values.size) : undefined,
          seed: values.seed ? Number(values.seed) : undefined,
          concurrency: values.concurrency
            ? Number(values.concurrency)
            : undefined,
          reset: values.reset === true,
          allowDatabase: values['allow-database'] as string[],
          crudN: values['crud-n'] ? Number(values['crud-n']) : undefined,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'sweep': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_SWEEP_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          url: { type: 'string' },
          'api-key': { type: 'string' },
          'content-type': { type: 'string' },
          'filter-field': { type: 'string' },
          'relation-field': { type: 'string' },
          out: { type: 'string' },
          yes: { type: 'boolean', default: false },
          'page-sizes': { type: 'string' },
          vus: { type: 'string' },
          'target-rps': { type: 'string' },
          stages: { type: 'string' },
          'read-only': { type: 'boolean', default: false },
          'database-url': { type: 'string' },
          'http-seed': { type: 'boolean', default: false },
          bundle: { type: 'string' },
          size: { type: 'string' },
          seed: { type: 'string' },
          concurrency: { type: 'string' },
          reset: { type: 'boolean', default: false },
          'allow-database': { type: 'string', multiple: true, default: [] },
        },
      });
      const r = await runPerfSweep({
        cwd: process.cwd(),
        apiKey,
        flags: {
          url: values.url,
          apiKey: values['api-key'],
          contentType: values['content-type'],
          filterField: values['filter-field'],
          relationField: values['relation-field'],
          out: values.out,
          yes: values.yes === true,
          pageSizes: values['page-sizes']
            ? values['page-sizes'].split(',').map((s) => Number(s.trim()))
            : undefined,
          vus: values.vus
            ? values.vus.split(',').map((s) => Number(s.trim()))
            : undefined,
          targetRps: values['target-rps']
            ? Number(values['target-rps'])
            : undefined,
          stages: values.stages
            ? values.stages.split(',').map((s) => Number(s.trim()))
            : undefined,
          readOnly: values['read-only'] === true,
          databaseUrl: values['database-url'],
          httpSeed: values['http-seed'] === true,
          bundle: values.bundle,
          size: values.size ? Number(values.size) : undefined,
          seed: values.seed ? Number(values.seed) : undefined,
          concurrency: values.concurrency
            ? Number(values.concurrency)
            : undefined,
          reset: values.reset === true,
          allowDatabase: values['allow-database'] as string[],
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'report': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_REPORT_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          from: { type: 'string' },
          out: { type: 'string' },
        },
      });
      const r = await runPerfReport({
        cwd: process.cwd(),
        flags: { from: values.from, out: values.out },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'seed': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_SEED_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          'content-type': { type: 'string' },
          'database-url': { type: 'string' },
          'http-seed': { type: 'boolean', default: false },
          bundle: { type: 'string' },
          size: { type: 'string' },
          seed: { type: 'string' },
          concurrency: { type: 'string' },
          'allow-database': { type: 'string', multiple: true, default: [] },
          reset: { type: 'boolean', default: false },
          url: { type: 'string' },
          'api-key': { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
      });

      // Merge config defaults (CLI flags win).
      let configPerf: import('./config.js').ProjectPerfConfig | undefined;
      let configCms: import('./config.js').ProjectConfig['cms'] | undefined;
      try {
        const { loadProjectConfig } = await import('./config.js');
        const r = await loadProjectConfig(process.cwd());
        configPerf = r.config.perf;
        configCms = r.config.cms;
      } catch {
        // No config file is fine — operator can pass everything via flags.
      }

      const contentType = values['content-type'] ?? configPerf?.contentType;
      if (!contentType) {
        process.stderr.write(
          'boject perf seed requires --content-type (or perf.contentType in .boject.config.json)\n'
        );
        return 1;
      }
      const size = values.size
        ? Number(values.size)
        : (configPerf?.size ?? 10000);
      if (!Number.isFinite(size) || size < 1) {
        process.stderr.write(`Invalid --size: ${values.size}\n`);
        return 1;
      }
      const seed = values.seed ? Number(values.seed) : configPerf?.seed;
      const concurrency = values.concurrency
        ? Number(values.concurrency)
        : undefined;
      const databaseUrl = values['database-url'] ?? configPerf?.perfDatabaseUrl;
      try {
        await runPerfSeed({
          contentType,
          size,
          seed,
          databaseUrl,
          httpSeed: values['http-seed'],
          bundle: values.bundle,
          concurrency,
          allowDatabase: values['allow-database'] as string[],
          reset: values.reset === true,
          url:
            values.url ??
            process.env.BOJECT_CMS_URL ??
            (configCms?.url as string | undefined),
          apiKey: values['api-key'] ?? process.env.BOJECT_API_KEY,
          yes: values.yes === true,
        });
        return 0;
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        return 1;
      }
    }
    case 'reset': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(PERF_RESET_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          'database-url': { type: 'string' },
          'allow-database': { type: 'string', multiple: true, default: [] },
          yes: { type: 'boolean', default: false },
        },
      });
      try {
        await runPerfReset({
          databaseUrl: values['database-url'],
          allowDatabase: values['allow-database'] as string[],
          yes: values.yes === true,
        });
        return 0;
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        return 1;
      }
    }
    default:
      process.stderr.write(`Unknown perf subcommand: ${subcommand}\n`);
      process.stdout.write(PERF_USAGE);
      return 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exit(0);
  }

  const [command, ...rest] = argv;

  if (command === 'schema') {
    const code = await dispatchSchema(rest);
    process.exit(code);
  }

  if (command === 'apikey') {
    const code = await dispatchApikey(rest);
    process.exit(code);
  }

  if (command === 'perf') {
    const code = await dispatchPerf(rest);
    process.exit(code);
  }

  if (command === 'upgrade') {
    const { values } = parseArgs({
      args: rest,
      allowPositionals: false,
      options: {
        to: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
      },
    });
    const { exitCode, message } = await runUpgrade({
      cwd: process.cwd(),
      runner: nodeRunner,
      flags: {
        to: values.to,
        dryRun: values['dry-run'] === true,
        check: values.check === true,
      },
      stdout,
      stderr,
    });
    const sink = exitCode === 0 ? process.stdout : process.stderr;
    sink.write(`${message}\n`);
    process.exit(exitCode);
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.stderr.write(USAGE);
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
