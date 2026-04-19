#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

function main(): void {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('Usage: pnpm dev:publish:image:as <version>\n');
    process.exit(1);
  }
  const tag = `localhost:5555/boject/cms:${version}`;
  const build = spawnSync(
    'docker',
    ['build', '-f', 'apps/cms/Dockerfile', '-t', tag, '.'],
    { stdio: 'inherit' }
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
  const push = spawnSync('docker', ['push', tag], { stdio: 'inherit' });
  process.exit(push.status ?? 1);
}

main();
