import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveHostPort } from './hostPort.js';
import { renderNextSteps } from './nextSteps.js';
import {
  resolveAiAssist,
  resolveCliApiKey,
  resolveStarter,
} from './prompts.js';
import { starterNames } from './starters.js';
import { IMAGE_TAG } from './version.js';
import { writeProject } from './writeProject.js';

interface ParsedArgs {
  targetDir: string;
  force: boolean;
  starter: string | undefined;
  imageTag: string;
  hostPort: number;
  ai: boolean | undefined;
  apiKey: boolean | undefined;
}

function parseCli(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      force: { type: 'boolean', default: false },
      starter: { type: 'string' },
      image: { type: 'string' },
      port: { type: 'string' },
      ai: { type: 'boolean' },
      'api-key': { type: 'boolean' },
    },
  });

  if (positionals.length !== 1) {
    process.stderr.write(
      'Usage: create-boject-cms <target-dir> [--force] [--starter <name>] [--image <tag>] [--port <n>] [--ai] [--no-api-key]\n'
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
    apiKey: values['api-key'],
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
    apiKey,
  } = parseCli(process.argv.slice(2));
  const isTTY = process.stdin.isTTY === true;
  const startersSourceDir = resolveStartersSourceDir();
  const starter = await resolveStarter({
    flag: starterFlag,
    isTTY,
    starters: starterNames(startersSourceDir),
  });
  const aiAssist = await resolveAiAssist({ flag: ai, isTTY });
  const cliApiKey = await resolveCliApiKey({ flag: apiKey, isTTY });

  const { adminEmail, adminPassword, cliApiKeyCreated } = await writeProject({
    targetDir,
    starter,
    imageTag,
    force,
    startersSourceDir,
    hostPort,
    aiAssist,
    cliApiKey,
  });

  process.stdout.write(
    renderNextSteps({
      targetDir,
      hostPort,
      adminEmail,
      adminPassword,
      aiAssist,
      cliApiKeyCreated,
    })
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
