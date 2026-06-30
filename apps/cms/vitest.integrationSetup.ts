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
import { createTestPrismaClient, resetTestDb } from './test/testDb';

const prisma = createTestPrismaClient();

afterAll(async () => {
  try {
    await resetTestDb(prisma);
  } finally {
    await prisma.$disconnect();
  }
});
