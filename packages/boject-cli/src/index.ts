import { parseArgs } from 'node:util';
import { runUpgrade, type CommandRunner } from './commands/upgrade.js';
import { runSchemaPull } from './commands/schemaPull.js';
import { runSchemaValidate } from './commands/schemaValidate.js';
import { runSchemaApply } from './commands/schemaApply.js';
import { runSchemaCheck } from './commands/schemaCheck.js';
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

Run \`boject <command> --help\` for command-specific flags.
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
