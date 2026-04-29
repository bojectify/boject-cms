import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['scenarios/**', 'reports/**'],
    passWithNoTests: true,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    sequence: { groupOrder: 1 },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'lib/**/*.test.ts',
            'seed/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          globals: true,
        },
      },
    ],
  },
});
