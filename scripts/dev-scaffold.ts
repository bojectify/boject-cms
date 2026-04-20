#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

const REGISTRY = 'http://localhost:4873';
const IMAGE = 'localhost:5555/boject/cms:0.0.1-rc.1';

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
      : undefined;

  const result = spawnSync(
    'pnpm',
    [
      'create',
      'boject-cms',
      targetDir,
      '--image',
      IMAGE,
      ...(starter !== undefined ? ['--starter', starter] : []),
      '--force',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_registry: REGISTRY,
        npm_config_prefer_online: 'true',
      },
    }
  );

  process.exit(result.status ?? 1);
}

main();
