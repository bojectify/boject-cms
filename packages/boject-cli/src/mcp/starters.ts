import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Starter bundle basenames present in `startersDir` (e.g. the bundled
 * dist/starters). Returns an empty list if the directory doesn't exist yet
 * (e.g. running from source before a build has populated dist/starters) —
 * "no starters directory" means "no starters", not an error.
 */
export function listStarterNames(startersDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(startersDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return entries
    .filter((f) => f.endsWith('.boject.json'))
    .map((f) => f.replace(/\.boject\.json$/, ''))
    .sort();
}

export function readStarter(
  startersDir: string,
  name: string
): Promise<string> {
  return readFile(join(startersDir, `${name}.boject.json`), 'utf8');
}
