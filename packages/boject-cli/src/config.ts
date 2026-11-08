import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ProjectPerfConfig {
  contentType?: string;
  filterField?: string;
  relationField?: string;
  out?: string;
  size?: number;
  seed?: number;
  perfDatabaseUrl?: string;
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
  const root = await findProjectRoot(cwd);
  if (!root) {
    throw new Error(
      `No .boject.config.json found in ${cwd} or any parent directory.`
    );
  }
  const candidate = join(root, FILENAME);
  const raw = await readFile(candidate, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${candidate}: ${(err as Error).message}`);
  }
  return {
    config: validateConfig(parsed, candidate),
    configPath: candidate,
  };
}

/**
 * Walk up from `cwd` to the nearest directory containing
 * `.boject.config.json` and return it, or `null` if none is found before the
 * filesystem root. Never parses or validates the file, so callers that only
 * need the project root (e.g. `.env` loading, #505) don't fail on a bad config.
 */
export async function findProjectRoot(cwd: string): Promise<string | null> {
  let dir = cwd;
  while (true) {
    try {
      await stat(join(dir, FILENAME));
      return dir;
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !('code' in err) ||
        (err as { code?: string }).code !== 'ENOENT'
      ) {
        throw err;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
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
    'perfDatabaseUrl',
  ] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`${path}: perf.${key} must be a non-empty string`);
    }
    out[key] = v;
  }
  if (obj.size !== undefined) {
    if (
      typeof obj.size !== 'number' ||
      !Number.isInteger(obj.size) ||
      obj.size < 1
    ) {
      throw new Error(`${path}: perf.size must be a positive integer`);
    }
    out.size = obj.size;
  }
  if (obj.seed !== undefined) {
    if (typeof obj.seed !== 'number' || !Number.isInteger(obj.seed)) {
      throw new Error(`${path}: perf.seed must be an integer`);
    }
    out.seed = obj.seed;
  }
  return out;
}
