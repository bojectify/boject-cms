import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['scenarios/**', 'reports/**'],
    passWithNoTests: true,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
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
