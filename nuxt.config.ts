export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  modules: ['@nuxt/ui', '@nuxt/eslint'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
  },

  nitro: {
    externals: {
      inline: ['@prisma/adapter-pg', 'graphql-yoga'],
    },
  },
});
