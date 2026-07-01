import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './test/dbUrl';
import { getTestRedisUrl } from './test/redisUrl';
import { meili } from './server/utils/meili';
import {
  ensureEntriesIndex,
  resolveEntriesIndex,
} from './server/utils/searchIndex';
import {
  resolveMaxTestWorkers,
  suffixDatabaseUrl,
  suffixRedisUrl,
  suffixMeiliIndex,
  TEST_MEILI_INDEX_BASE,
} from './test/workerScope';

const TEST_DATABASE_URL = getTestDatabaseUrl();

/**
 * Clone `boject_test` (the migrated+seeded template) into one DB per worker via
 * `CREATE DATABASE … TEMPLATE` — a fast file copy. Connects to the maintenance
 * `postgres` DB to issue CREATE/DROP. The template must have no open connections;
 * it doesn't here because the migrate/seed subprocesses have exited and this
 * process never connects to it. `CREATEDB` privilege is assumed (see plan).
 */
async function provisionWorkerDatabases(baseUrl: string, workerCount: number) {
  const adminUrl = new URL(baseUrl);
  const templateName = adminUrl.pathname.slice(1); // "boject_test"
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    for (let id = 1; id <= workerCount; id++) {
      // Derive the name via the same suffix fn the resolvers use, so they can't drift.
      const dbName = new URL(suffixDatabaseUrl(baseUrl, id)).pathname.slice(1);
      // WITH (FORCE) (pg 13+) drops even if a stale connection lingers on the target.
      await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await client.query(
        `CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`
      );
    }
    console.log(
      `[globalSetup] Provisioned ${workerCount} worker database(s) from ${templateName}.`
    );
  } finally {
    await client.end();
  }
}

/**
 * Flush one Redis logical DB with the same tolerant retry the base flush uses.
 * Returns `true` on success; on exhaustion, returns the last error (instead of
 * swallowing it) so the caller can log what actually went wrong (Redis down vs
 * auth vs wrong URL) rather than a generic "unavailable" warning.
 */
async function flushRedisDb(url: string): Promise<true | unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      await redis.connect();
      await redis.flushdb();
      await redis.quit();
      return true;
    } catch (error) {
      lastError = error;
      redis.disconnect();
      if (attempt < 5) await new Promise((r) => setTimeout(r, 300));
    }
  }
  return lastError;
}

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

  const workerCount = resolveMaxTestWorkers();
  await provisionWorkerDatabases(TEST_DATABASE_URL, workerCount);

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

    for (let id = 1; id <= workerCount; id++) {
      await ensureEntriesIndex(
        meili,
        suffixMeiliIndex(TEST_MEILI_INDEX_BASE, id)
      );
    }
    console.log(`[globalSetup] Bootstrapped ${workerCount} worker index(es).`);
  } catch (error) {
    console.warn(
      '[globalSetup] Meilisearch unavailable; skipping test index bootstrap. Search-backed tests will fail until it is reachable:',
      error instanceof Error ? error.message : error
    );
  }

  // Flush the test Redis logical DB (DB 1) so each suite run starts with a
  // clean cache and cache state never leaks across files. NEVER FLUSHALL —
  // that wipes DB 0, the dev cache (the same instance-isolation pg/meili use).
  // Non-fatal if Redis is unreachable (mirrors the Meili branch): cache-backed
  // tests fail loudly on their own; non-cache tests still run. A fresh client
  // per attempt handles the docker-up race without ioredis reconnect-state
  // pitfalls.
  const redisUrl = getTestRedisUrl();
  const baseFlushResult = await flushRedisDb(redisUrl);
  if (baseFlushResult === true) {
    console.log('[globalSetup] Test Redis (DB 1) flushed.');
  } else {
    console.warn(
      '[globalSetup] Redis unavailable; skipping cache flush. Cache-backed tests will fail until it is reachable:',
      baseFlushResult instanceof Error
        ? baseFlushResult.message
        : baseFlushResult
    );
  }
  for (let id = 1; id <= workerCount; id++) {
    await flushRedisDb(suffixRedisUrl(redisUrl, id));
  }
}
