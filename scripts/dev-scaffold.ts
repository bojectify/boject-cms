#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

const REGISTRY = 'http://localhost:4873';
const IMAGE = 'localhost:5555/boject/cms:dev';

function main(): void {
  const args = process.argv.slice(2);
  const targetDir = args[0];
  if (!targetDir || targetDir.startsWith('-')) {
    process.stderr.write('Usage: pnpm dev:scaffold <dir> [--starter <name>]\n');
    process.exit(1);
  }

  const rest = args.slice(1);
  const starterIdx = rest.indexOf('--starter');
  const starter =
    starterIdx >= 0 && rest[starterIdx + 1] !== undefined
      ? rest[starterIdx + 1]
      : 'base';

  const result = spawnSync(
    'pnpm',
    [
      '--registry',
      REGISTRY,
      '--prefer-online',
      'create',
      'boject-cms',
      targetDir,
      '--image',
      IMAGE,
      '--starter',
      starter,
      '--force',
    ],
    { stdio: 'inherit' }
  );

  process.exit(result.status ?? 1);
}

main();
