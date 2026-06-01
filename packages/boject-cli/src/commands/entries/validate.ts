import { readFile } from 'node:fs/promises';
import { validateBundle } from '../../vendor/validateBundle.js';
import type { Bundle } from '../../vendor/contentBundleTypes.js';

export interface EntriesValidateParams {
  path?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface EntriesValidateResult {
  exitCode: 0 | 1;
}

export async function runEntriesValidate(
  params: EntriesValidateParams
): Promise<EntriesValidateResult> {
  if (!params.path) {
    params.stderr(
      'Error: a bundle path is required (boject entries validate <path>).'
    );
    return { exitCode: 1 };
  }

  let raw: string;
  try {
    raw = await readFile(params.path, 'utf8');
  } catch (err) {
    params.stderr(`Error reading ${params.path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    params.stderr(`Error parsing ${params.path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const v = validateBundle(parsed as Bundle);
  if (!v.ok) {
    params.stderr('✗ Bundle invalid');
    for (const e of v.errors) params.stderr(`  - ${e.path}: ${e.message}`);
    return { exitCode: 1 };
  }

  const bundle = parsed as Bundle;
  const n = bundle.entries?.length ?? 0;
  params.stdout('✓ Bundle valid');
  params.stdout(`  ${n} entr${n === 1 ? 'y' : 'ies'}`);
  return { exitCode: 0 };
}
