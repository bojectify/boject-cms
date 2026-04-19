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
  external: ['yaml', 'semver'],
  banner: { js: '#!/usr/bin/env node' },
});
