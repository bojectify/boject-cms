import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveHostPort } from './hostPort.js';
import { resolveStarter, resolveAiAssist } from './prompts.js';
import { IMAGE_TAG } from './version.js';
import { writeProject } from './writeProject.js';

interface ParsedArgs {
  targetDir: string;
  force: boolean;
  starter: string | undefined;
  imageTag: string;
  hostPort: number;
  ai: boolean | undefined;
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
      ai: { type: 'boolean' },
    },
  });

  if (positionals.length !== 1) {
    process.stderr.write(
      'Usage: create-boject-cms <target-dir> [--force] [--starter <name>] [--image <tag>] [--port <n>] [--ai]\n'
    );
    process.exit(1);
  }

  return {
    targetDir: resolve(positionals[0]),
    force: values.force === true,
    starter: values.starter,
    imageTag: values.image ?? IMAGE_TAG,
    hostPort: resolveHostPort(values.port),
    ai: values.ai,
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
    ai,
  } = parseCli(process.argv.slice(2));
  const isTTY = process.stdin.isTTY === true;
  const starter = await resolveStarter({ flag: starterFlag, isTTY });
  const aiAssist = await resolveAiAssist({ flag: ai, isTTY });

  const { adminEmail, adminPassword } = await writeProject({
    targetDir,
    starter,
    imageTag,
    force,
    startersSourceDir: resolveStartersSourceDir(),
    hostPort,
    aiAssist,
  });

  const aiNextSteps = aiAssist
    ? `
AI-assisted content modelling is set up (.mcp.json). To model your content,
open this folder in Claude Code, approve the "boject" server, then run:
  /mcp__boject__model_content
See "AI-assisted content modelling" in README.md for the full flow.
`
    : '';

  process.stdout.write(`
Scaffolded boject-cms project at ${targetDir}

Next steps:
  cd ${targetDir}
  docker compose up -d

Once the container is healthy, log in at http://localhost:${hostPort}/login with:
  Email:    ${adminEmail}
  Password: ${adminPassword}

This password is also saved in .env — you will NOT see it again.
${aiNextSteps}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
