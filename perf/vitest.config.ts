import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'seed/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['scenarios/**', 'reports/**'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
