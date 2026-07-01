// Per-file integration-test cleanup (#406).
//
// setupFiles run once per test file, so this registers an `afterAll` that runs
// after EVERY integration file — restoring boject_test to the seeded baseline
// (truncate all data tables + re-seed admin/API key) so files run
// independently: reorder, `.skip`, `.only`, and `--filter` no longer change
// outcomes. Wired onto the `integration` vitest project only (vitest.config.ts);
// the unit + storybook projects have no database.
//
// This setupFile is evaluated before the test file's own code, so its afterAll
// is registered first; vitest runs afterAll hooks LIFO, so this reset runs LAST
// — after @nuxt/test-utils tears down the dev server and after any cleanup the
// file itself declares. A dedicated client is used because setupFiles run in
// the test process, separate from the booted Nuxt server's Prisma client.
import { afterAll } from 'vitest';
import { getTestDatabaseUrl } from './test/dbUrl';
import { getTestRedisUrl } from './test/redisUrl';
import { resolveTestMeiliIndex } from './test/workerScope';
import { createTestPrismaClient, resetTestDb } from './test/testDb';

// #409: scope this worker's DB / Redis DB / Meili index by VITEST_POOL_ID BEFORE
// any setup({ dev: true }) runs. The booted Nuxt server inherits these via
// `...process.env` at spawn, and the direct test-process resolvers read them too,
// so the whole file — server + direct pg/meili/redis access — is isolated to this
// worker's resources. Idempotent: each value is suffixed from a STABLE base.
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.REDIS_URL = getTestRedisUrl();
process.env.MEILI_INDEX = resolveTestMeiliIndex();

const prisma = createTestPrismaClient();

afterAll(async () => {
  try {
    await resetTestDb(prisma);
  } finally {
    await prisma.$disconnect();
  }
});
