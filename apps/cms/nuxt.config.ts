import { resolve } from 'node:path';
import { buildStorageConfig } from './utils/storageConfig';

export default defineNuxtConfig({
  ignore: ['**/storage/**'],
  compatibilityDate: '2024-11-01',

  // #409: isolate the dev build dir per vitest worker so parallel
  // setup({ dev: true }) servers stop colliding on the shared .nuxt/dev.
  // The child `nuxi _dev` inherits VITEST_POOL_ID via ...process.env, so it
  // re-resolves the same worker-scoped path. Non-pooled contexts (main
  // process / globalSetup) keep the default .nuxt (harmless — they boot no
  // dev server).
  ...(process.env.VITEST_POOL_ID
    ? {
        buildDir: resolve(
          __dirname,
          `.nuxt-test-${process.env.VITEST_POOL_ID}`
        ),
      }
    : {}),

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

    // Pre-bundle deps Vite would otherwise discover lazily at runtime — each
    // discovery forces a re-optimize + full page reload mid-session. These are
    // the CJS / deep-import deps surfaced across the CMS's heavier routes
    // (rich-text editor, query builder, content table). Keep in sync with what
    // the dev server reports as "New dependencies found".
    // https://vite.dev/guide/dep-pre-bundling.html
    optimizeDeps: {
      include: [
        '@internationalized/date',
        'dayjs',
        'dayjs/plugin/relativeTime',
        'lodash/kebabCase',
        'lowlight',
        'vuedraggable',
        'zod',
        '@tiptap/core',
        '@tiptap/vue-3',
        '@tiptap/starter-kit',
        '@tiptap/extension-image',
        '@tiptap/extension-table',
        '@tiptap/extension-table-row',
        '@tiptap/extension-table-cell',
        '@tiptap/extension-table-header',
        '@tiptap/extension-code-block-lowlight',
      ],
    },

    // #409: isolate the Vite dep-optimizer cache per vitest worker too — Vite
    // anchors it to rootDir (not buildDir), so parallel dev servers otherwise
    // race on the shared node_modules/.cache/vite (ENOTEMPTY). Non-pooled
    // contexts keep the default cache dir.
    ...(process.env.VITEST_POOL_ID
      ? {
          cacheDir: `node_modules/.cache/vite-test-${process.env.VITEST_POOL_ID}`,
        }
      : {}),
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
      // Mirror the prod `storage.cache` Redis mount in dev so integration tests
      // that boot a Nitro dev server (setup({ dev: true })) get a real Redis-backed
      // cache. Without this, Nitro dev mode falls back to an fs driver for the
      // `cache` mount and `taggedCache.assertRedisInstance` throws.
      cache: { driver: 'redis', url: process.env.REDIS_URL },
    },
    storage: {
      ...buildStorageConfig(),
      // Cache backend for the caching epic (#254). Redis via the unstorage
      // redis driver; REDIS_URL overrides the ioredis default of
      // localhost:6379. Kept inline (not in buildStorageConfig) because that
      // helper is shared with the standalone bundle CLI, which has no cache.
      cache: { driver: 'redis', url: process.env.REDIS_URL },
    },
    experimental: { tasks: true },
    scheduledTasks: {
      '0 3 * * *': ['webhooks:cleanup'],
    },
  },
});
