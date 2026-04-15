#!/usr/bin/env tsx
// scripts/build-starters/index.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAll } from './build';
import { normalize } from './normalize';

const DEFAULT_ROOT = resolve(process.cwd(), 'starters');

async function main(): Promise<void> {
  const [, , cmd = 'build', ...rest] = process.argv;
  const rootFlag = rest.find((a) => a.startsWith('--root='));
  const root = rootFlag
    ? resolve(process.cwd(), rootFlag.slice('--root='.length))
    : DEFAULT_ROOT;

  if (cmd === 'build') {
    const results = await buildAll(root);
    for (const r of results) {
      console.log(`built ${r.name} -> ${r.path}`);
    }
    return;
  }

  if (cmd === 'check') {
    const overlayNames = getOverlayNames(root);
    const before = new Map<string, string>();
    for (const name of overlayNames) {
      const path = join(root, `${name}.boject.json`);
      try {
        before.set(name, readFileSync(path, 'utf8'));
      } catch {
        console.error(`missing built bundle for "${name}" at ${path}`);
        process.exit(1);
      }
    }
    await buildAll(root);
    const drift: string[] = [];
    for (const name of overlayNames) {
      const path = join(root, `${name}.boject.json`);
      const after = readFileSync(path, 'utf8');
      if (normalize(after) !== normalize(before.get(name)!)) {
        drift.push(name);
      }
    }
    if (drift.length > 0) {
      console.error(
        `Starter outputs are stale for: ${drift.join(', ')}. Run "pnpm starters:build" and commit.`
      );
      process.exit(1);
    }
    console.log('starters are up to date');
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

function getOverlayNames(root: string): string[] {
  return readdirSync(join(root, 'src'))
    .filter((f) => f.endsWith('.overlay.json'))
    .map((f) => f.replace(/\.overlay\.json$/, ''));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
