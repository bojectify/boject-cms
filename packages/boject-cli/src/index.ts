import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { runUpgrade, type CommandRunner } from './commands/upgrade.js';
import { CLI_VERSION } from './version.js';

const USAGE = `Usage: boject <command> [flags]

Commands:
  upgrade            Upgrade the CMS image tag in the current directory's
                     docker-compose.yml, pull the new image, restart, and
                     wait for health.

Flags for \`upgrade\`:
  --to <version>     Use a specific target tag (bypasses tag discovery).
  --dry-run          Print the diff without applying.
  --check            Print whether an upgrade is available; exit 1 if so.
  --version          Print the CLI version and exit.
  --help             Print this message and exit.
`;

const nodeRunner: CommandRunner = {
  run(cmd, args, opts) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: 'inherit' });
      child.on('close', (code) => resolve({ status: code }));
    });
  },
};

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

  const command = argv[0];
  const rest = argv.slice(1);

  if (command !== 'upgrade') {
    process.stderr.write(`Unknown command: ${command}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }

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
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });

  const sink = exitCode === 0 ? process.stdout : process.stderr;
  sink.write(`${message}\n`);
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
