// scripts/build-starters/build.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prettier from 'prettier';
import type { Bundle } from '../content-bundle/types';
import { validateBundle } from '../content-bundle/validate';
import { mergeOverlay } from './merge';
import type { Overlay } from './types';
import { validateOverlay } from './validate';

export interface BuildOptions {
  now?: string;
}

export interface BuildResult {
  name: string;
  path: string;
}

export async function buildAll(
  root: string,
  opts: BuildOptions = {}
): Promise<BuildResult[]> {
  const srcDir = join(root, 'src');
  const overlayFiles = safeReaddir(srcDir).filter((f) =>
    f.endsWith('.overlay.json')
  );

  const overlays = new Map<string, Overlay>();
  for (const file of overlayFiles) {
    const raw = readFileSync(join(srcDir, file), 'utf8');
    const overlay = JSON.parse(raw) as Overlay;
    const result = validateOverlay(overlay);
    if (!result.ok) {
      throw new Error(
        `Invalid overlay ${file}:\n${formatErrors(result.errors)}`
      );
    }
    if (overlays.has(overlay.name)) {
      throw new Error(`Duplicate overlay name "${overlay.name}" in ${file}`);
    }
    overlays.set(overlay.name, overlay);
  }

  const ordered = topoSort(overlays);
  const results: BuildResult[] = [];

  for (const overlay of ordered) {
    const parent = loadParent(root, overlay.extends!, overlays, results);
    const merged = mergeOverlay(parent, overlay);
    if (opts.now) {
      merged.exportedAt = opts.now;
    }
    const validation = validateBundle(merged);
    if (!validation.ok) {
      throw new Error(
        `Built bundle "${overlay.name}" failed validation:\n${formatErrors(
          validation.errors
        )}`
      );
    }
    const outPath = join(root, `${overlay.name}.boject.json`);
    const json = JSON.stringify(merged, null, 2) + '\n';
    const formatted = await prettier.format(json, {
      parser: 'json',
      filepath: outPath,
    });
    writeFileSync(outPath, formatted);
    results.push({ name: overlay.name, path: outPath });
  }

  return results;
}

function loadParent(
  root: string,
  parentName: string,
  overlays: Map<string, Overlay>,
  built: BuildResult[]
): Bundle {
  const builtParent = built.find((r) => r.name === parentName);
  if (builtParent) {
    return JSON.parse(readFileSync(builtParent.path, 'utf8')) as Bundle;
  }
  const rootPath = join(root, `${parentName}.boject.json`);
  let raw: string;
  try {
    raw = readFileSync(rootPath, 'utf8');
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      throw new Error(
        `unknown parent bundle "${parentName}" (expected ${rootPath} or a built overlay)`
      );
    }
    throw err;
  }
  return JSON.parse(raw) as Bundle;
}

function topoSort(overlays: Map<string, Overlay>): Overlay[] {
  const result: Overlay[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, stack: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `cycle detected in overlay extends chain: ${stack.join(' -> ')} -> ${name}`
      );
    }
    visiting.add(name);
    const overlay = overlays.get(name);
    if (!overlay) return;
    if (overlay.extends && overlays.has(overlay.extends)) {
      visit(overlay.extends, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    result.push(overlay);
  }

  for (const name of overlays.keys()) {
    visit(name, []);
  }
  return result;
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function formatErrors(errors: { path: string; message: string }[]): string {
  return errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
}
