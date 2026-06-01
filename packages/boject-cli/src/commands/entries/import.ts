import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../../config.js';
import { importEntriesRemote, HttpError } from '../../api.js';
import type { Bundle, EntriesImportResultLike } from '../../types.js';

export interface EntriesImportFlags {
  path?: string;
  url?: string;
  author?: string;
  onConflict?: 'fail' | 'skip' | 'replace';
  dryRun?: boolean;
}

export interface EntriesImportParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: EntriesImportFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface EntriesImportResult {
  exitCode: 0 | 1;
}

export async function runEntriesImport(
  params: EntriesImportParams
): Promise<EntriesImportResult> {
  const flags = params.flags ?? {};
  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }
  if (!flags.path) {
    params.stderr(
      'Error: a bundle path is required (boject entries import <path>).'
    );
    return { exitCode: 1 };
  }

  let config: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    config = await loadProjectConfig(params.cwd);
  } catch (err) {
    params.stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const url = flags.url ?? config.config.cms.url;
  const pathAbs = isAbsolute(flags.path)
    ? flags.path
    : resolve(dirname(config.configPath), flags.path);

  let raw: string;
  try {
    raw = await readFile(pathAbs, 'utf8');
  } catch (err) {
    params.stderr(`Error reading ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch (err) {
    params.stderr(`Error parsing ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  try {
    const result = await importEntriesRemote(
      { baseUrl: url, apiKey: params.apiKey },
      {
        bundle,
        author: flags.author,
        onConflict: flags.onConflict ?? 'fail',
        dryRun: flags.dryRun === true,
      }
    );
    printImportResult(result, params.stdout, flags.dryRun === true);
    return { exitCode: 0 };
  } catch (err) {
    printImportError(err, params.stderr);
    return { exitCode: 1 };
  }
}

function printImportResult(
  r: EntriesImportResultLike,
  stdout: (l: string) => void,
  dryRun: boolean
): void {
  stdout(dryRun ? '✓ Dry run — no changes written.' : '✓ Imported entries');
  stdout(`  ${r.entriesCreated} created`);
  stdout(`  ${r.entriesUpdated} updated`);
  stdout(`  ${r.entriesSkipped} skipped`);
}

function printImportError(err: unknown, stderr: (l: string) => void): void {
  if (err instanceof HttpError && err.code === 'ENTRY_IMPORT_CONFLICT') {
    stderr(`✗ ${err.message}`);
    stderr('  Re-run with --on-conflict skip or --on-conflict replace.');
    return;
  }
  if (err instanceof HttpError && err.code === 'BUNDLE_INVALID') {
    stderr('✗ Bundle invalid');
    const data = err.data as {
      errors?: Array<{ path: string; message: string }>;
    } | null;
    for (const e of data?.errors ?? []) stderr(`  - ${e.path}: ${e.message}`);
    return;
  }
  if (
    err instanceof HttpError &&
    err.code === 'ENTRY_IMPORT_REFERENCE_INVALID'
  ) {
    stderr(`✗ ${err.message}`);
    return;
  }
  if (err instanceof HttpError) {
    stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    return;
  }
  stderr(`Error: ${(err as Error).message}`);
}
