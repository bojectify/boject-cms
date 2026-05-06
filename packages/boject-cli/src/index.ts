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
  perf <command>     Run perf scenarios / sweep / report / check.

Run \`boject <command> --help\` for command-specific flags.
`;

const PERF_USAGE = `Usage: boject perf <command> [flags]

Commands:
  scenario <name>   Run one scenario (graphql-flat | graphql-sitemap).
  sweep             Run all scenarios across the default sweep matrix.
  report            Re-render a previous run.
  check             Preflight verification (k6, target, key, content type, fields).

Run \`boject perf <command> --help\` for command-specific flags.
`;

const PERF_CHECK_USAGE = `Usage: boject perf check --content-type <id> [--url <url>] [--filter-field <id>] [--relation-field <id>]

Verifies: k6 is on PATH, target reachable, API key valid with content:read scope,
content type exists, and DATETIME / single-target RELATION fields can be selected.
Exits 0 on success, 2 on environment problems, 3 on input problems.
`;

const PERF_SCENARIO_USAGE = `Usage: boject perf scenario <name> --content-type <id> [flags]

Scenarios:
  graphql-flat       RPS ramp 50→2000 over 3 minutes (heavy load).
  graphql-sitemap    Cursor pagination drain at varied page sizes / VU levels.

Common flags:
  --url <url>             Target CMS base URL. Defaults to .boject.config.json.
  --api-key <key>         Bearer token. Defaults to $BOJECT_API_KEY.
  --filter-field <id>     Override DATETIME field for the "filtered" shape.
  --relation-field <id>   Override single-target RELATION field for "relation" shape.
  --out <dir>             Report output dir. Default ./perf-reports/.
  --yes                   Skip the heavy-run confirm prompt (CI-friendly).

graphql-flat power-user overrides:
  --target-rps <n>        Override peak RPS.
  --duration <s>          Override total duration.
  --stages <csv>          Comma-separated RPS stages, e.g. 50,100,500,2000.
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

Recognised scopes: content:read, schema:read, schema:write, apikey:read, apikey:write.

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
          duration: { type: 'string' },
          stages: { type: 'string' },
        },
      });
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
          duration: values.duration,
          stages: values.stages
            ? values.stages.split(',').map((s) => Number(s.trim()))
            : undefined,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    // sweep / report cases added in later tasks
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
