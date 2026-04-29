import { fileURLToPath } from 'node:url';

// When the cms vitest config is loaded from the monorepo-root workspace,
// test workers inherit the root cwd. @nuxt/test-utils' setup() uses
// process.cwd() to locate nuxt.config.ts, so anchor it back to apps/cms.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
