import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { applySchemaRemote, HttpError } from '../api.js';
import type { Bundle, BlockerLike } from '../types.js';

export interface SchemaApplyFlags {
  path?: string;
  url?: string;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export interface SchemaApplyParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: SchemaApplyFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaApplyResult {
  exitCode: 0 | 1;
}

export async function runSchemaApply(
  params: SchemaApplyParams
): Promise<SchemaApplyResult> {
  const flags = params.flags ?? {};
  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
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
  const pathRel = flags.path ?? config.config.schema.path;
  const pathAbs = isAbsolute(pathRel)
    ? pathRel
    : resolve(dirname(config.configPath), pathRel);

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

  const ctx = { baseUrl: url, apiKey: params.apiKey };
  const args = {
    bundle,
    allowDestructive: flags.allowDestructive === true,
    dryRun: flags.dryRun === true,
  };

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const result = await applySchemaRemote(ctx, args);
      printApplyResult(result, params.stdout, flags.dryRun === true);
      return { exitCode: 0 };
    } catch (err) {
      if (
        err instanceof HttpError &&
        err.code === 'SCHEMA_CHANGED_DURING_APPLY' &&
        attempt === 1
      ) {
        params.stdout('Schema changed during apply — retrying once...');
        continue;
      }
      printApplyError(err, params.stderr);
      return { exitCode: 1 };
    }
  }
}

function printApplyResult(
  result: { changed: boolean; applied: Record<string, number> },
  stdout: (l: string) => void,
  dryRun: boolean
): void {
  const banner = dryRun ? '✓ Dry run' : '✓ Applied';
  if (!result.changed) {
    stdout(`${banner} — no changes.`);
    return;
  }
  const a = result.applied;
  stdout(banner);
  for (const [label, verb, n] of [
    ['content type', 'created', a.contentTypesCreated],
    ['content type', 'updated', a.contentTypesUpdated],
    ['content type', 'removed', a.contentTypesRemoved],
    ['field', 'created', a.fieldsCreated],
    ['field', 'updated', a.fieldsUpdated],
    ['field', 'removed', a.fieldsRemoved],
  ] as const) {
    if (n === 0) continue;
    stdout(
      `  ${n} ${label}${n === 1 ? '' : label.endsWith('y') ? '' : 's'} ${verb}`
    );
  }
}

function printApplyError(err: unknown, stderr: (l: string) => void): void {
  if (err instanceof HttpError && err.code === 'SCHEMA_APPLY_BLOCKED') {
    stderr('✗ Apply blocked');
    const data = err.data as { blockers?: BlockerLike[] } | null;
    for (const b of data?.blockers ?? []) {
      stderr(`  - ${b.code} at ${b.path}: ${b.message}`);
    }
    return;
  }
  if (err instanceof HttpError && err.code === 'SCHEMA_CHANGED_DURING_APPLY') {
    stderr('✗ Schema changed during apply twice in a row — re-run later.');
    return;
  }
  if (err instanceof HttpError && err.code === 'BUNDLE_INVALID') {
    stderr('✗ Bundle invalid');
    const data = err.data as {
      errors?: Array<{ path: string; message: string }>;
    } | null;
    for (const e of data?.errors ?? []) {
      stderr(`  - ${e.path}: ${e.message}`);
    }
    return;
  }
  if (err instanceof HttpError) {
    stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    return;
  }
  stderr(`Error: ${(err as Error).message}`);
}
