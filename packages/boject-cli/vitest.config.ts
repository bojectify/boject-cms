import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
          environment: 'node',
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          testTimeout: 10_000,
          // Serialise e2e files: upgrade.test.ts and schemaCommands.test.ts
          // both run `pnpm --filter @boject/cli build` in beforeAll, and
          // parallel tsup invocations race on dist/vendor (rm/cp ENOTEMPTY).
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.integration.test.ts'],
          environment: 'node',
          // pg connect + migrate reset is slow on first run; allow headroom.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['./tests/integration/globalSetup.ts'],
          // Serialise: tests share boject_perf_test; running in parallel
          // races on TRUNCATE between beforeEach hooks.
          fileParallelism: false,
        },
      },
    ],
  },
});
