import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { getTestDatabaseUrl } from './test/dbUrl';
import { getTestRedisUrl } from './test/redisUrl';

// Tests use a separate database so dev data is never touched.
process.env.DATABASE_URL = getTestDatabaseUrl();

// Tests target a separate Meilisearch index (`entries_test`) so a `pnpm test`
// run never clobbers the dev `entries` index on the shared local Meilisearch
// container. resolveEntriesIndex() (server/utils/searchIndex.ts) reads
// MEILI_INDEX; the Nitro dev server booted by integration tests inherits it
// from this process, exactly as it inherits DATABASE_URL above. A host-set
// MEILI_INDEX still wins (parallel runners / dedicated engines).
process.env.MEILI_INDEX = process.env.MEILI_INDEX || 'entries_test';

// Tests target a separate Redis logical DB (DB 1) so a `pnpm test` run never
// clobbers the dev cache on DB 0 of the shared local Redis container. Set
// unconditionally (like DATABASE_URL above — NOT `||`-guarded like MEILI_INDEX):
// a dev's REDIS_URL points at DB 0 (the live dev cache) and the integration
// test FLUSHDB-s its target DB, so honouring a host REDIS_URL here would wipe
// the dev cache and defeat the isolation. Override the test target via
// INTEGRATION_TEST_REDIS_URL (honoured by getTestRedisUrl), exactly like
// INTEGRATION_TEST_DATABASE_URL drives DATABASE_URL above.
process.env.REDIS_URL = getTestRedisUrl();

export default defineConfig({
  resolve: {
    alias: {
      '#prisma': fileURLToPath(
        new URL('./generated/prisma/client', import.meta.url)
      ),
      '#generated': fileURLToPath(new URL('./generated', import.meta.url)),
    },
  },
  test: {
    setupFiles: [
      fileURLToPath(new URL('./vitest.workerSetup.ts', import.meta.url)),
    ],
    coverage: {
      provider: 'v8', // or 'istanbul'
    },
    silent: 'passed-only',
    // reporters: ['verbose'],
    // Using plain vitest config instead of @nuxt/test-utils/config because
    // defineVitestConfig's "nuxt" environment is incompatible with Nuxt 4.3.1
    // (publicAssetsURL build error). Our e2e tests only need the "node"
    // environment since they start a real dev server via setup({ dev: true }).
    //
    // When @nuxt/test-utils is updated for Nuxt 4.3+, switch back to:
    //   import { defineVitestConfig } from '@nuxt/test-utils/config';
    //   export default defineVitestConfig({
    //     test: {
    //       fileParallelism: false,
    //       environmentMatchGlobs: [['server/**/*.test.ts', 'node']],
    //     },
    //   });
    // This will give server tests the "node" env and component/unit tests
    // the "nuxt" env (with auto-imports, Vue runtime, composables, etc.).
    projects: [
      {
        extends: true,
        test: {
          name: 'integration',
          // Scoped here (not root) so only this project runs serially. Each
          // integration file boots a Nuxt dev server via setup({ dev: true })
          // and shares the boject_test database, so parallel files would
          // collide on ports and DB state. The unit and storybook projects
          // have no such shared state and run with default file parallelism.
          fileParallelism: false,
          include: [
            'server/api/**/*.test.ts',
            'server/middleware/**/*.test.ts',
            // DB-backed parity test for slugify; lives next to slugify.ts but
            // needs a real Postgres connection so it runs in the integration
            // project (and is excluded from the unit project below).
            'utils/slugify.pg-parity.test.ts',
            // Migration tests use raw pg.Client to create ad-hoc DBs and
            // exercise migration.sql against them. Requires a live Postgres.
            'prisma/migrations/**/*.test.ts',
            '**/*.integration.test.ts',
          ],
          globals: true,
          globalSetup: fileURLToPath(
            new URL('./vitest.globalSetup.ts', import.meta.url)
          ),
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'composables/**/*.test.ts',
            'scripts/**/*.test.ts',
            'server/utils/**/*.test.ts',
            'test/**/*.test.ts',
            'utils/**/*.test.ts',
            '!**/*.integration.test.ts',
          ],
          exclude: ['utils/slugify.pg-parity.test.ts'],
          globals: true,
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: fileURLToPath(new URL('./.storybook', import.meta.url)),
          }),
        ],
        optimizeDeps: {
          include: ['storybook/test'],
        },
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
