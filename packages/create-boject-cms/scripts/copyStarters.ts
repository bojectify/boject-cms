import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_STARTERS = resolve(PACKAGE_ROOT, '..', '..', 'starters');
const DIST_STARTERS = join(PACKAGE_ROOT, 'dist', 'starters');

const EXPECTED = ['web-base', 'articles', 'sport', 'rugby'] as const;

async function main(): Promise<void> {
  await mkdir(DIST_STARTERS, { recursive: true });
  for (const name of EXPECTED) {
    const source = join(REPO_STARTERS, `${name}.boject.json`);
    const dest = join(DIST_STARTERS, `${name}.boject.json`);
    await copyFile(source, dest);
    process.stdout.write(`copied ${name}.boject.json\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`copyStarters failed: ${message}\n`);
  process.exit(1);
});
