import { readFile } from 'node:fs/promises';
import type { Bundle } from '../../../vendor/contentBundleTypes.js';
import { validateBundle } from '../../../vendor/validateBundle.js';

/**
 * Reads a JSON bundle from disk and runs it through the same validateBundle
 * the schema CLI uses (vendored at `../../../vendor/validateBundle.ts`).
 * Used by `boject perf seed --bundle <path>` for fully-offline seeding.
 *
 * Errors are formatted in the same shape `boject schema validate` produces,
 * with each validation error on its own line.
 */
export async function loadBundleFile(path: string): Promise<Bundle> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read bundle file ${path}: ${(err as Error).message}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Bundle JSON parse error in ${path}: ${(err as Error).message}`
    );
  }
  const result = validateBundle(parsed);
  if (!result.ok) {
    const messages = result.errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n');
    throw new Error(`Bundle validation failed for ${path}:\n${messages}`);
  }
  return parsed as Bundle;
}
