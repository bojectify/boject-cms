import withNuxt from './.nuxt/eslint.config.mjs';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { sharedCoreRules, sharedTsRules } from '../../eslint.rules.shared.mjs';

export default withNuxt(
  {
    ignores: ['generated/**'],
  },
  {
    rules: sharedCoreRules,
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: sharedTsRules,
  },
  {
    // #405 guard: the content-bundle + docker-entrypoint scripts run under tsx
    // at docker boot, where apps/cms/server/ isn't on disk and the #prisma
    // Nuxt alias doesn't resolve. Ban eager static server/ imports + #prisma
    // VALUE imports so a regression fails lint instead of slipping to the
    // manual docker smoke-test (the only other gate). Lazy `await import(...)`
    // of server/ is a dynamic-import expression, not a static import, so it is
    // not matched — that's the intended boot-safe escape hatch.
    files: [
      'scripts/content-bundle/**/*.ts',
      'scripts/docker-entrypoint/**/*.ts',
    ],
    // Tests (*.test.ts / *.integration.test.ts) run under vitest in the dev
    // tree where server/ exists — never under tsx at boot — so they may import
    // server/ freely. The guard targets the production boot-graph scripts only.
    ignores: ['**/*.test.ts'],
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          // `#prisma` is an exact module specifier — it must go in `paths`, not
          // `patterns`: in gitignore-style pattern globs a leading `#` is a
          // comment, so `#prisma` as a pattern would silently never match.
          paths: [
            {
              name: '#prisma',
              allowTypeImports: true,
              message:
                'Import Prisma VALUES from the relative ../../generated/prisma/client; #prisma is a Nuxt build-only alias unresolvable under tsx. `import type` from #prisma is fine.',
            },
          ],
          patterns: [
            {
              group: ['**/server/**'],
              message:
                'Boot-graph scripts run under tsx where apps/cms/server/ is not on disk. Move the pure util to apps/cms/utils/, or lazy-import it (await import) guarded on ERR_MODULE_NOT_FOUND.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: sharedTsRules,
  },
  eslintConfigPrettier
);
