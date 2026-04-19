import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: false,
  dts: false,
  external: ['@clack/prompts'],
  banner: { js: '#!/usr/bin/env node' },
});
