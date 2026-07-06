import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `root` must be pinned to this directory: unlike the per-package configs
// (invoked via `pnpm --filter <pkg> test`, which cd's into that package
// first), this config is invoked directly from the repo root
// (`vitest run --config scripts/vitest.config.ts`), so Vite's default
// `root` (process.cwd()) would otherwise stay at the repo root and the
// `*.test.ts` include pattern would never match files under `scripts/`.
export default defineConfig({
  test: {
    name: 'scripts',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
