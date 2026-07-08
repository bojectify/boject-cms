// scripts/build-starters/build.ts
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prettier from 'prettier';
import type { Bundle } from '../content-bundle/types';
import { validateBundle } from '../content-bundle/validate';
import { mergeOverlay, composeParents } from './merge';
import type { FieldPartial, Overlay } from './types';
import { normalizeExtends } from './types';
import { validateOverlay, validateFieldPartial } from './validate';

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
    const expectedName = file.replace(/\.overlay\.json$/, '');
    if (overlay.name !== expectedName) {
      throw new Error(
        `Overlay file ${file} declares name "${overlay.name}"; expected "${expectedName}" to match the filename`
      );
    }
    if (overlays.has(overlay.name)) {
      throw new Error(`Duplicate overlay name "${overlay.name}" in ${file}`);
    }
    overlays.set(overlay.name, overlay);
  }

  const fieldPartials = loadFieldPartials(srcDir);

  const ordered = topoSort(overlays);
  const results: BuildResult[] = [];

  for (const overlay of ordered) {
    const parents = normalizeExtends(overlay.extends).map((name) =>
      loadParent(root, name, results)
    );
    const merged = mergeOverlay(
      composeParents(parents),
      overlay,
      fieldPartials
    );
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

function loadFieldPartials(srcDir: string): Map<string, FieldPartial> {
  const dir = join(srcDir, 'partials');
  const map = new Map<string, FieldPartial>();
  for (const file of safeReaddir(dir).filter((f) => f.endsWith('.json'))) {
    const partial = JSON.parse(
      readFileSync(join(dir, file), 'utf8')
    ) as FieldPartial;
    const result = validateFieldPartial(partial);
    if (!result.ok) {
      throw new Error(
        `Invalid field-partial ${file}:\n${formatErrors(result.errors)}`
      );
    }
    const expected = file.replace(/\.json$/, '');
    if (partial.name !== expected) {
      throw new Error(
        `Field-partial ${file} declares name "${partial.name}"; expected "${expected}"`
      );
    }
    if (map.has(partial.name))
      throw new Error(`Duplicate field-partial name "${partial.name}"`);
    map.set(partial.name, partial);
  }
  return map;
}

function loadParent(
  root: string,
  parentName: string,
  built: BuildResult[]
): Bundle {
  const builtParent = built.find((r) => r.name === parentName);
  if (builtParent)
    return JSON.parse(readFileSync(builtParent.path, 'utf8')) as Bundle;
  for (const candidate of [
    join(root, `${parentName}.boject.json`),
    join(root, 'modules', `${parentName}.boject.json`),
  ]) {
    if (existsSync(candidate))
      return JSON.parse(readFileSync(candidate, 'utf8')) as Bundle;
  }
  throw new Error(
    `unknown parent bundle "${parentName}" (expected ${join(root, `${parentName}.boject.json`)}, ${join(root, 'modules', `${parentName}.boject.json`)}, or a built overlay)`
  );
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
    for (const parent of normalizeExtends(overlay.extends)) {
      if (overlays.has(parent)) visit(parent, [...stack, name]);
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
