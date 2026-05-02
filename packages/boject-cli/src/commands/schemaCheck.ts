import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { getSchemaBundle, HttpError } from '../api.js';
import type { Bundle, BundleContentType, BundleField } from '../types.js';

export interface SchemaCheckParams {
  cwd: string;
  apiKey: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaCheckResult {
  exitCode: 0 | 1;
}

export async function runSchemaCheck(
  params: SchemaCheckParams
): Promise<SchemaCheckResult> {
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
  const url = config.config.cms.url;
  const pathRel = config.config.schema.path;
  const pathAbs = isAbsolute(pathRel)
    ? pathRel
    : resolve(dirname(config.configPath), pathRel);

  let local: Bundle;
  try {
    local = JSON.parse(await readFile(pathAbs, 'utf8')) as Bundle;
  } catch (err) {
    params.stderr(`Error reading ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  let remote: Bundle;
  try {
    remote = await getSchemaBundle({ baseUrl: url, apiKey: params.apiKey });
  } catch (err) {
    if (err instanceof HttpError) {
      params.stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    } else {
      params.stderr(`Error: ${(err as Error).message}`);
    }
    return { exitCode: 1 };
  }

  const diffs = diffBundles(local, remote);
  if (diffs.length === 0) {
    params.stdout(`✓ Schema in sync with ${url}`);
    return { exitCode: 0 };
  }
  params.stderr(`✗ Drift detected against ${url}`);
  for (const d of diffs) params.stderr(`  - ${d}`);
  params.stderr('Run `boject schema pull` to update the local file.');
  return { exitCode: 1 };
}

function diffBundles(local: Bundle, remote: Bundle): string[] {
  const out: string[] = [];
  const localTypes = new Map<string, BundleContentType>();
  for (const ct of local.contentTypes ?? []) localTypes.set(ct.identifier, ct);
  const remoteTypes = new Map<string, BundleContentType>();
  for (const ct of remote.contentTypes ?? [])
    remoteTypes.set(ct.identifier, ct);

  for (const [id, ct] of localTypes) {
    if (!remoteTypes.has(id)) {
      out.push(`${id}: type exists locally but not on the server`);
      continue;
    }
    const r = remoteTypes.get(id)!;
    out.push(...diffFields(id, ct.fields, r.fields));
  }
  for (const id of remoteTypes.keys()) {
    if (!localTypes.has(id)) {
      out.push(`${id}: type exists on the server but not locally`);
    }
  }
  return out;
}

function diffFields(
  typeId: string,
  local: BundleField[],
  remote: BundleField[]
): string[] {
  const out: string[] = [];
  const localFields = new Map(local.map((f) => [f.identifier, f]));
  const remoteFields = new Map(remote.map((f) => [f.identifier, f]));
  for (const id of localFields.keys()) {
    if (!remoteFields.has(id)) {
      out.push(`${typeId}: field '${id}' exists locally but not on the server`);
    }
  }
  for (const id of remoteFields.keys()) {
    if (!localFields.has(id)) {
      out.push(`${typeId}: field '${id}' exists on the server but not locally`);
    }
  }
  return out;
}
