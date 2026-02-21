export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
  },

  nitro: {
    externals: {
      inline: ['@prisma/adapter-pg'],
    },
  },
});
