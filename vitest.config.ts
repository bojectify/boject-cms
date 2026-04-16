import { defineConfig } from 'vitest/config';

// Tests use a separate database so dev data is never touched.
process.env.DATABASE_URL =
  'postgresql://boject:boject@localhost:5432/boject_test';

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: 'v8', // or 'istanbul'
    },
    reporters: ['verbose'],
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
          include: [
            'server/api/**/*.test.ts',
            'server/middleware/**/*.test.ts',
          ],
          globals: true,
          globalSetup: './vitest.globalSetup.ts',
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'scripts/**/*.test.ts',
            'starters/**/*.test.ts',
            'server/utils/**/*.test.ts',
            'utils/**/*.test.ts',
          ],
          globals: true,
        },
      },
    ],
  },
});
