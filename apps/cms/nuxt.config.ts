import { resolve } from 'node:path';

type StorageSpec = Record<string, { driver: string; [key: string]: unknown }>;

function buildStorageConfig(): StorageSpec {
  const driver = process.env.STORAGE_DRIVER ?? 'local';

  if (driver === 'local') {
    const base = process.env.STORAGE_LOCAL_BASE ?? '/app/storage';
    return {
      'images:originals': {
        driver: 'fs',
        base: `${base}/images/originals`,
      },
      'images:transforms': {
        driver: 'fs',
        base: `${base}/images/transforms`,
      },
    };
  }

  if (driver === 's3' || driver === 'r2') {
    const bucket =
      driver === 'r2' ? required('R2_BUCKET') : required('S3_BUCKET');
    const accessKeyId =
      driver === 'r2'
        ? required('R2_ACCESS_KEY_ID')
        : required('AWS_ACCESS_KEY_ID');
    const secretAccessKey =
      driver === 'r2'
        ? required('R2_SECRET_ACCESS_KEY')
        : required('AWS_SECRET_ACCESS_KEY');
    const region = driver === 'r2' ? 'auto' : required('AWS_REGION');
    const endpoint =
      driver === 'r2'
        ? `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
        : undefined;

    const base = {
      driver: 's3',
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      ...(endpoint ? { endpoint } : {}),
    };

    return {
      'images:originals': { ...base, pathPrefix: 'images/originals/' },
      'images:transforms': { ...base, pathPrefix: 'images/transforms/' },
    };
  }

  throw new Error(
    `Unsupported STORAGE_DRIVER: "${driver}". Expected one of: local, s3, r2.`
  );
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name} for the configured STORAGE_DRIVER`
    );
  }
  return v;
}

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
