import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_STARTERS = resolve(PACKAGE_ROOT, '..', '..', 'starters');
const DIST_STARTERS = join(PACKAGE_ROOT, 'dist', 'starters');

async function main(): Promise<void> {
  await mkdir(DIST_STARTERS, { recursive: true });
  const files = (await readdir(REPO_STARTERS)).filter((f) =>
    f.endsWith('.boject.json')
  );
  for (const file of files) {
    await copyFile(join(REPO_STARTERS, file), join(DIST_STARTERS, file));
    process.stdout.write(`copied ${file}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`copyStarters failed: ${message}\n`);
  process.exit(1);
});
