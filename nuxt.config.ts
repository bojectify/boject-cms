export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils'],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
  },

  nitro: {
    externals: {
      inline: ['@prisma/adapter-pg', 'graphql-yoga'],
    },
  },
});
