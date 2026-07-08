import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { starterNames } from '../../src/starters.js';

/** Absolute path to the repo-root `starters/` dir, from this test file's location. */
export const REPO_STARTERS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'starters'
);
/** The real shipped starter set (derived), for test loops. */
export const STARTERS = starterNames(REPO_STARTERS);
