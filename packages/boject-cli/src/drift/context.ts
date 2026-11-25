import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parse } from 'yaml';
import { gitCheckIgnore } from '../projectEnv.js';
import type { DriftContext, EnvFileName } from './types.js';

export interface CreateDriftContextOptions {
  root: string;
  version: string | null;
  shellEnv: Readonly<Record<string, string | undefined>>;
  isGitIgnored?: (path: string, root: string) => Promise<boolean | null>;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readCompose(
  root: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(join(root, 'docker-compose.yml'), 'utf8');
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
  const parsed: unknown = parse(raw);
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : null;
}

export async function createDriftContext({
  root,
  version,
  shellEnv,
  isGitIgnored = gitCheckIgnore,
}: CreateDriftContextOptions): Promise<DriftContext> {
  const compose = await readCompose(root);
  const envCache = new Map<EnvFileName, Record<string, string> | null>();

  return {
    root,
    version,
    shellEnv,
    compose,
    async readEnvFile(name) {
      if (envCache.has(name)) return envCache.get(name) ?? null;
      let result: Record<string, string> | null;
      try {
        const raw = await readFile(join(root, name), 'utf8');
        result = parseEnv(raw.replace(/\r/g, '')) as Record<string, string>;
      } catch (err) {
        if (!isEnoent(err)) throw err;
        result = null;
      }
      envCache.set(name, result);
      return result;
    },
    isGitIgnored: (path) => isGitIgnored(path, root),
  };
}
