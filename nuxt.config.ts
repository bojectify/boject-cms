import { resolve } from 'node:path';

export default defineNuxtConfig({
  ignore: ['**/storage/**'],
  compatibilityDate: '2024-11-01',

  devServer: {
    // _PORT is set by @nuxt/test-utils when starting the dev server for tests
    port: Number(process.env._PORT) || 4000,
  },

  modules: ['@nuxt/ui', 'nuxt-auth-utils', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  alias: {
    '#prisma': resolve(__dirname, 'generated/prisma/client'),
    '#generated': resolve(__dirname, 'generated'),
  },

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
  },

  nitro: {
    externals: {
      inline: ['@prisma/adapter-pg', 'graphql-yoga'],
      external: ['sharp'],
    },
    devStorage: {
      'images:originals': {
        driver: 'fs',
        base: './storage/images/originals',
      },
      'images:transforms': {
        driver: 'fs',
        base: './storage/images/transforms',
      },
    },
  },
});
