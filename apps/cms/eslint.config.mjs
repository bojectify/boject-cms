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
