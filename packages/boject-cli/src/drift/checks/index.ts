import type { DriftCheck } from '../types.js';
import { cliApiKey } from './cliApiKey.js';
import { envLocalGitignored } from './envLocalGitignored.js';
import { searchAndCacheServices } from './searchAndCacheServices.js';
import { staleBootstrapKey } from './staleBootstrapKey.js';

export const DRIFT_CHECKS: readonly DriftCheck[] = [
  searchAndCacheServices,
  envLocalGitignored,
  cliApiKey,
  staleBootstrapKey,
];
