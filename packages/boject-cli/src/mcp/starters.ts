import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STARTER_NAMES = [
  'web-base',
  'articles',
  'sport',
  'rugby',
] as const;
export type StarterName = (typeof STARTER_NAMES)[number];

export async function readStarter(
  startersDir: string,
  name: StarterName
): Promise<string> {
  return readFile(join(startersDir, `${name}.boject.json`), 'utf8');
}
