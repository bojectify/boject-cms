// Shared lint rules used by both the root flat-config base (for non-Nuxt
// packages) and the cms package's @nuxt/eslint-based config. Keep this file
// limited to *rule entries* — parser, plugin, and globals scaffolding is
// the responsibility of each consumer, since cms gets that from withNuxt()
// and the base sets it up directly.

// Rules that only need core ESLint (no plugin context required).
export const sharedCoreRules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
      message:
        "Avoid 'as unknown as T' double casts. Try 'as T' directly or an intersection type (e.g. 'as Window & typeof globalThis & { ... }'). If the source genuinely has insufficient overlap with the target, add an eslint-disable-next-line comment with a brief reason.",
    },
  ],
};

// Rules that require the @typescript-eslint plugin to be registered in the
// same config block (or earlier in the cascade).
export const sharedTsRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      varsIgnorePattern: '^_',
      argsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
};
