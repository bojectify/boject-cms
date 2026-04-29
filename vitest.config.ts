import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      './apps/cms/vitest.config.ts',
      './packages/boject-cli/vitest.config.ts',
      './packages/create-boject-cms/vitest.config.ts',
      './perf/vitest.config.ts',
    ],
  },
});
