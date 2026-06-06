import { execSync } from 'node:child_process';
import { getTestDatabaseUrl } from './test/dbUrl';
import { meili } from './server/utils/meili';
import {
  ensureEntriesIndex,
  resolveEntriesIndex,
} from './server/utils/searchIndex';

const TEST_DATABASE_URL = getTestDatabaseUrl();

/**
 * Reset the test database to a clean seeded state and bootstrap the test search
 * index before the suite runs. Uses a separate "boject_test" database and a
 * separate `entries_test` Meilisearch index so dev state in "boject" / the
 * `entries` index is untouched.
 */
export async function setup() {
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
      'Automated test suite database reset',
  };

  console.log('[globalSetup] Resetting test database (boject_test)...');
  // `pnpm exec` runs the locally-installed prisma (the version Prisma
  // generated the client from). `pnpx` / `pnpm dlx` would download a fresh
  // copy from the registry instead, hit the `allowBuilds` interactive
  // prompt on a clean pnpm store, and risk version drift between the
  // migrator and the generated client.
  execSync('pnpm exec prisma migrate reset --force', {
    stdio: 'inherit',
    env,
  });
  console.log('[globalSetup] Running seed...');
  // Invoke the test seed script directly rather than via a pnpm alias —
  // there is no top-level `prisma:seed` anymore (the dev-facing alias was
  // dropped to prevent test fixtures landing in the dev DB). DATABASE_URL
  // is already overridden in `env` by the caller.
  execSync('pnpm exec tsx prisma/seed.ts', { stdio: 'inherit', env });
  console.log('[globalSetup] Test database ready.');

  // Bootstrap the test Meilisearch index (resolveEntriesIndex() → `entries_test`
  // under vitest) so search-backed integration tests have an index to clear and
  // populate. Non-fatal: if Meilisearch is unreachable, warn and continue so
  // non-search integration tests still run (graceful degradation, mirroring the
  // boot-time search-index-bootstrap plugin). Search-backed tests then fail
  // loudly on their own — exactly as DB-backed tests require Postgres.
  const searchIndex = resolveEntriesIndex();
  try {
    console.log(
      `[globalSetup] Bootstrapping test search index (${searchIndex})...`
    );
    await ensureEntriesIndex(meili, searchIndex);
    console.log('[globalSetup] Test search index ready.');
  } catch (error) {
    console.warn(
      '[globalSetup] Meilisearch unavailable; skipping test index bootstrap. Search-backed tests will fail until it is reachable:',
      error instanceof Error ? error.message : error
    );
  }
}
