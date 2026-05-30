import base from '../eslint.config.base.mjs';

export default [
  ...base,
  {
    ignores: ['reports/**', 'scripts/render-report.fixtures/**'],
  },
  {
    files: ['lib/**/*.ts', 'scenarios/**/*.ts'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __ITER: 'readonly',
        __VU: 'readonly',
      },
    },
  },
];
