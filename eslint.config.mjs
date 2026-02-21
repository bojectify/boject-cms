// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs';
import eslintConfigPrettier from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';

export default withNuxt(
  {
    ignores: ['generated/**'],
  },
  {
    files: ['*.config.ts', '**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
    },
  },
  eslintConfigPrettier
);
