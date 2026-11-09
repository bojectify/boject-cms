import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLI_ENV_VARS, isCliEnvVar } from '../../src/projectEnv.js';

// Guards the explicit .env allowlist (#512): every env var the CLI reads must
// be loadable from the project's .env.local / .env, and the list must not keep
// names the CLI no longer reads.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
// Controls file loading itself, so it's only ever read from the shell.
const SHELL_ONLY = new Set(['BOJECT_NO_DOTENV']);

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

async function envReads(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of await sourceFiles(SRC)) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      names.add(m[1]!);
    }
  }
  return names;
}

describe('CLI_ENV_VARS (#512)', () => {
  it('covers every process.env read in the CLI source', async () => {
    const missing = [...(await envReads())].filter(
      (name) => !SHELL_ONLY.has(name) && !isCliEnvVar(name)
    );
    expect(missing).toEqual([]);
  });

  it('lists only variables the CLI actually reads', async () => {
    const reads = await envReads();
    const unused = Object.values(CLI_ENV_VARS).filter((v) => !reads.has(v));
    expect(unused).toEqual([]);
  });

  it('isCliEnvVar rejects container settings', () => {
    expect(isCliEnvVar('BOJECT_API_KEY')).toBe(true);
    expect(isCliEnvVar('BOJECT_ADMIN_PASSWORD')).toBe(false);
    expect(isCliEnvVar('BOJECT_NO_DOTENV')).toBe(false);
    expect(isCliEnvVar(undefined)).toBe(false);
  });
});
