import { resolve } from 'node:path';

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

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
    },
  },
});
