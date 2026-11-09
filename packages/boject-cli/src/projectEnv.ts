import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { findProjectRoot } from './config.js';

/**
 * Project `.env` loading (#505). The CLI loads `.env.local` then `.env` from
 * the directory holding `.boject.config.json`, so a scaffolded project's API
 * key works without exporting it in the shell.
 *
 * - Only the variables the CLI reads ({@link CLI_ENV_VARS}) are loaded. The
 *   project `.env` also holds the CMS container's settings — many of them
 *   `BOJECT_*` (`BOJECT_ADMIN_PASSWORD`, `BOJECT_HOST_PORT`, …) — which the CLI
 *   never reads and shouldn't hold or pass on to child processes (#512).
 * - Nothing overwrites a variable that's already set, so the shell wins, and
 *   because `.env.local` is read first it wins over `.env`.
 * - `BOJECT_NO_DOTENV=1` (or `true`) turns it off.
 * - Warns when a loaded `.env.local` isn't gitignored (older scaffolds only
 *   ignore `.env`).
 */

/** Files read, in precedence order (earlier wins). */
const ENV_FILES = ['.env.local', '.env'] as const;

/**
 * Every environment variable the CLI reads, and so the only keys loaded from
 * `.env.local` / `.env` (#512). A new environment-variable read in the CLI
 * must be added here too — tests/unit/cliEnvVars.test.ts fails otherwise.
 * `BOJECT_NO_DOTENV` is deliberately absent: it controls file loading, so it's
 * only ever read from the shell.
 */
export const CLI_ENV_VARS = {
  BOJECT_API_KEY: 'BOJECT_API_KEY',
  BOJECT_CMS_URL: 'BOJECT_CMS_URL',
  PERF_DATABASE_URL: 'PERF_DATABASE_URL',
  PERF_SAMPLER_CONTAINER: 'PERF_SAMPLER_CONTAINER',
  PERF_SAMPLER_INTERVAL_MS: 'PERF_SAMPLER_INTERVAL_MS',
  PERF_SAMPLER_OUT: 'PERF_SAMPLER_OUT',
} as const;

export type CliEnvVar = (typeof CLI_ENV_VARS)[keyof typeof CLI_ENV_VARS];

const CLI_ENV_VARS_SET: ReadonlySet<string> = new Set(
  Object.values(CLI_ENV_VARS)
);

export function isCliEnvVar(value: unknown): value is CliEnvVar {
  return typeof value === 'string' && CLI_ENV_VARS_SET.has(value);
}

export interface ProjectEnvResult {
  /** Directory holding `.boject.config.json`, or `null` outside a project. */
  root: string | null;
  /** Absolute paths of the env files looked for (whether or not they exist). */
  checkedFiles: string[];
  /** Keys copied into the environment from the files. */
  loadedKeys: string[];
  /** Messages for stderr. */
  warnings: string[];
}

export interface LoadProjectEnvOptions {
  cwd: string;
  /** The environment to fill (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /**
   * Whether `path` is gitignored in the repo at `root`: `true`/`false`, or
   * `null` when that can't be determined (not a git repo, git missing).
   */
  isGitIgnored?: (path: string, root: string) => Promise<boolean | null>;
}

const EMPTY: ProjectEnvResult = {
  root: null,
  checkedFiles: [],
  loadedKeys: [],
  warnings: [],
};

let lastResult: ProjectEnvResult = EMPTY;

export async function loadProjectEnv({
  cwd,
  env = process.env,
  isGitIgnored = gitCheckIgnore,
}: LoadProjectEnvOptions): Promise<ProjectEnvResult> {
  if (env.BOJECT_NO_DOTENV === '1' || env.BOJECT_NO_DOTENV === 'true') {
    lastResult = EMPTY;
    return lastResult;
  }
  const root = await findProjectRoot(cwd);
  if (!root) {
    lastResult = EMPTY;
    return lastResult;
  }

  const checkedFiles: string[] = [];
  const loadedKeys: string[] = [];
  const warnings: string[] = [];

  for (const name of ENV_FILES) {
    const path = join(root, name);
    checkedFiles.push(path);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    for (const [key, value] of Object.entries(parseEnv(raw))) {
      if (!isCliEnvVar(key)) continue;
      if (env[key] !== undefined) continue;
      env[key] = value;
      loadedKeys.push(key);
    }
    if (name === '.env.local' && (await isGitIgnored(path, root)) === false) {
      warnings.push(
        `Warning: ${path} is not gitignored — add \`.env.local\` to .gitignore so the API key isn't committed.`
      );
    }
  }

  lastResult = { root, checkedFiles, loadedKeys, warnings };
  return lastResult;
}

/**
 * The error for a missing API key, listing where the CLI looked. Defaults to
 * the most recent `loadProjectEnv` call.
 */
export function missingApiKeyMessage(
  result: ProjectEnvResult = lastResult
): string {
  const sources = ['environment', ...result.checkedFiles].join(', ');
  return `Error: BOJECT_API_KEY is not set (checked: ${sources}).`;
}

function gitCheckIgnore(path: string, root: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile('git', ['check-ignore', '-q', path], { cwd: root }, (err) => {
      if (!err) return resolve(true);
      // Exit 1 = not ignored; 128 = not a git repo; ENOENT = no git binary.
      const code = (err as { code?: number | string }).code;
      resolve(code === 1 ? false : null);
    });
  });
}
