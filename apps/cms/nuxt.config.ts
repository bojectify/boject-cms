import { resolve } from 'node:path';
import { buildStorageConfig } from './server/utils/storageConfig';

export default defineNuxtConfig({
  ignore: ['**/storage/**'],
  compatibilityDate: '2024-11-01',

  devServer: {
    // _PORT is set by @nuxt/test-utils when starting the dev server for tests
    port: Number(process.env._PORT) || 4000,
  },

  components: [{ path: '~/components', pathPrefix: false }],

  modules: ['@nuxt/ui', '@nuxt/fonts', 'nuxt-auth-utils', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  alias: {
    '#prisma': resolve(__dirname, 'generated/prisma/client'),
    '#generated': resolve(__dirname, 'generated'),
  },

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    schemaReadonly:
      process.env.BOJECT_SCHEMA_READONLY === 'true' ||
      process.env.BOJECT_SCHEMA_READONLY === '1',
    public: {
      schemaReadonly:
        process.env.BOJECT_SCHEMA_READONLY === 'true' ||
        process.env.BOJECT_SCHEMA_READONLY === '1',
    },
    session: {
      cookie: {
        sameSite: 'strict',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
      // `password` is read from NUXT_SESSION_PASSWORD at runtime by
      // nuxt-auth-utils; this stub satisfies the SessionConfig type on
      // `runtimeConfig.session`. In production, missing the env var is
      // a fatal misconfiguration — throw at boot so it can't silently
      // produce broken/weakly-sealed cookies.
      password:
        process.env.NUXT_SESSION_PASSWORD ??
        (process.env.NODE_ENV === 'production'
          ? (() => {
              throw new Error(
                'NUXT_SESSION_PASSWORD must be set in production'
              );
            })()
          : ''),
    },
  },

  vite: {
    server: {
      // Allow any client dev container to reach this dev server via
      // host.docker.internal. Vite's default allowedHosts guard 403s unknown
      // Host headers otherwise. Dev-server only (no production impact).
      allowedHosts: ['host.docker.internal'],
      // During tests, sequential dev servers fight over the default HMR
      // WebSocket port (24678). Disable HMR entirely — tests don't need it.
      ...(process.env.VITEST ? { hmr: false, ws: false } : {}),
    },
  },

  nitro: {
    rollupConfig: {
      onwarn(warning, defaultHandler) {
        // graphql-yoga's ESM barrel exports trigger Rollup's unused-import
        // detection — upstream packaging issue, harmless.
        if (
          warning.message?.includes('createYoga') &&
          warning.code === 'UNUSED_EXTERNAL_IMPORT'
        )
          return;

        // nuxt-auth-utils and nitropack have circular imports in their
        // published ESM bundles — upstream issue, nothing we can fix.
        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          warning.message?.includes('node_modules/')
        )
          return;

        defaultHandler(warning);
      },
    },
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
    storage: buildStorageConfig(),
    experimental: { tasks: true },
    scheduledTasks: {
      '0 3 * * *': ['webhooks:cleanup'],
    },
  },
});
