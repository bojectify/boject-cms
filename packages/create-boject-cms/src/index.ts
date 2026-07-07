import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveHostPort } from './hostPort.js';
import { resolveStarter } from './prompts.js';
import { IMAGE_TAG } from './version.js';
import { writeProject } from './writeProject.js';

interface ParsedArgs {
  targetDir: string;
  force: boolean;
  starter: string | undefined;
  imageTag: string;
  hostPort: number;
}

function parseCli(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      force: { type: 'boolean', default: false },
      starter: { type: 'string' },
      image: { type: 'string' },
      port: { type: 'string' },
    },
  });

  if (positionals.length !== 1) {
    process.stderr.write(
      'Usage: create-boject-cms <target-dir> [--force] [--starter <name>] [--image <tag>] [--port <n>]\n'
    );
    process.exit(1);
  }

  return {
    targetDir: resolve(positionals[0]),
    force: values.force === true,
    starter: values.starter,
    imageTag: values.image ?? IMAGE_TAG,
    hostPort: resolveHostPort(values.port),
  };
}

function resolveStartersSourceDir(): string {
  // index.js lives at dist/index.js; starters live at dist/starters/.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'starters');
}

async function main(): Promise<void> {
  const {
    targetDir,
    force,
    starter: starterFlag,
    imageTag,
    hostPort,
  } = parseCli(process.argv.slice(2));
  const starter = await resolveStarter({
    flag: starterFlag,
    isTTY: process.stdin.isTTY === true,
  });

  const { adminEmail, adminPassword } = await writeProject({
    targetDir,
    starter,
    imageTag,
    force,
    startersSourceDir: resolveStartersSourceDir(),
    hostPort,
  });

  process.stdout.write(`
Scaffolded boject-cms project at ${targetDir}

Next steps:
  cd ${targetDir}
  docker compose up -d

Once the container is healthy, log in at http://localhost:${hostPort}/login with:
  Email:    ${adminEmail}
  Password: ${adminPassword}

This password is also saved in .env — you will NOT see it again.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
