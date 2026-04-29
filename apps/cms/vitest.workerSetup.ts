// When the cms vitest config is loaded from the monorepo-root workspace,
// test workers inherit the root cwd. @nuxt/test-utils' setup() uses
// process.cwd() to locate nuxt.config.ts, so anchor it back to apps/cms.
// Skipped in browser-mode projects (storybook) where process.chdir is absent.
if (typeof process !== 'undefined' && typeof process.chdir === 'function') {
  process.chdir(import.meta.dirname);
}
