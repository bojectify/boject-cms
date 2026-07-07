import { defineConfig } from 'tsup';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'perf/index': 'src/perf/index.ts',
  },
  format: ['esm'],
  target: 'node24',
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: false,
  dts: false,
  external: ['yaml', 'semver'],
  banner: { js: '#!/usr/bin/env node' },
  async onSuccess() {
    // Mirror src/vendor/perf/{lib,scenarios} raw into dist/vendor/perf/
    // so k6 (spawned at runtime) can load the .ts scenarios directly.
    if (existsSync('dist/vendor')) {
      await rm('dist/vendor', { recursive: true });
    }
    await mkdir('dist/vendor/perf/scenarios', { recursive: true });
    await mkdir('dist/vendor/perf/lib', { recursive: true });
    await cp('src/vendor/perf/scenarios', 'dist/vendor/perf/scenarios', {
      recursive: true,
    });
    await cp('src/vendor/perf/lib', 'dist/vendor/perf/lib', {
      recursive: true,
    });
    // Also copy contentBundleTypes.ts so the workspace fixture and any
    // downstream TypeScript consumer can import @boject/cli/vendor/contentBundleTypes.
    await cp(
      'src/vendor/contentBundleTypes.ts',
      'dist/vendor/contentBundleTypes.ts'
    );
    // Mirror fieldTypes.ts the same way so consumers can import
    // @boject/cli/vendor/fieldTypes.
    await cp('src/vendor/fieldTypes.ts', 'dist/vendor/fieldTypes.ts');
    // Mirror contentStatus.ts the same way so consumers can import
    // @boject/cli/vendor/contentStatus.
    await cp('src/vendor/contentStatus.ts', 'dist/vendor/contentStatus.ts');
    // Copy the repo-root starter bundles so `boject mcp` can serve them as
    // example resources (resolved from dist/ at runtime).
    await mkdir('dist/starters', { recursive: true });
    for (const name of ['base', 'sport', 'rugby']) {
      await cp(
        `../../starters/${name}.boject.json`,
        `dist/starters/${name}.boject.json`
      );
    }
  },
});
