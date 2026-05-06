import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ProjectPerfConfig {
  contentType?: string;
  filterField?: string;
  relationField?: string;
  out?: string;
}

export interface ProjectConfig {
  cms: { url: string };
  schema: { path: string };
  perf?: ProjectPerfConfig;
}

export interface LoadResult {
  config: ProjectConfig;
  configPath: string;
}

const FILENAME = '.boject.config.json';

/**
 * Walk up from `cwd` looking for `.boject.config.json`, parse it, and
 * validate the required `cms.url` and `schema.path` fields.
 *
 * Mirrors how Prettier/ESLint/Vitest find their configs: a developer
 * running `boject schema pull` from a subdirectory will still pick up
 * the project root's config.
 *
 * @param cwd Directory to start the search from.
 * @returns The parsed config plus the absolute path it was loaded from.
 * @throws If no config is found between `cwd` and the filesystem root,
 *         the file cannot be parsed as JSON, or required fields are
 *         missing/invalid.
 */
export async function loadProjectConfig(cwd: string): Promise<LoadResult> {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, FILENAME);
    let exists = false;
    try {
      await stat(candidate);
      exists = true;
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !('code' in err) ||
        (err as { code?: string }).code !== 'ENOENT'
      ) {
        throw err;
      }
    }
    if (exists) {
      const raw = await readFile(candidate, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `Failed to parse ${candidate}: ${(err as Error).message}`
        );
      }
      return {
        config: validateConfig(parsed, candidate),
        configPath: candidate,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No .boject.config.json found in ${cwd} or any parent directory.`
      );
    }
    dir = parent;
  }
}

function validateConfig(parsed: unknown, path: string): ProjectConfig {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${path}: top-level value must be an object`);
  }
  const obj = parsed as Record<string, unknown>;
  const cms = obj.cms as { url?: unknown } | undefined;
  if (!cms || typeof cms.url !== 'string' || cms.url.length === 0) {
    throw new Error(`${path}: missing or invalid cms.url`);
  }
  const schema = obj.schema as { path?: unknown } | undefined;
  if (!schema || typeof schema.path !== 'string' || schema.path.length === 0) {
    throw new Error(`${path}: missing or invalid schema.path`);
  }
  const perf = validatePerf(obj.perf, path);
  const config: ProjectConfig = {
    cms: { url: cms.url },
    schema: { path: schema.path },
  };
  if (perf !== undefined) config.perf = perf;
  return config;
}

function validatePerf(
  raw: unknown,
  path: string
): ProjectPerfConfig | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${path}: perf must be an object if present`);
  }
  const obj = raw as Record<string, unknown>;
  const out: ProjectPerfConfig = {};
  for (const key of [
    'contentType',
    'filterField',
    'relationField',
    'out',
  ] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`${path}: perf.${key} must be a non-empty string`);
    }
    out[key] = v;
  }
  return out;
}
