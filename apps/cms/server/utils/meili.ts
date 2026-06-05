import { Meilisearch } from 'meilisearch';

export type MeiliConfig = { host: string; apiKey: string };

/**
 * Resolve Meilisearch connection config from the environment.
 *
 * - `MEILI_URL` defaults to http://localhost:7700 (the docker-compose sidecar).
 * - `MEILI_MASTER_KEY` is REQUIRED in production — throwing at boot mirrors the
 *   NUXT_SESSION_PASSWORD guard in nuxt.config.ts, so a misconfigured deploy
 *   fails fast instead of silently talking to an unauthenticated engine. In
 *   dev the sidecar runs unauthenticated, so an empty key is correct.
 *
 * Reads env on every call (no caching) so unit tests can assert each branch.
 */
export function resolveMeiliConfig(): MeiliConfig {
  const host = process.env.MEILI_URL || 'http://localhost:7700';
  const apiKey = process.env.MEILI_MASTER_KEY ?? '';

  if (!apiKey && process.env.NODE_ENV === 'production') {
    throw new Error('MEILI_MASTER_KEY must be set in production');
  }

  return { host, apiKey };
}

const meiliClientSingleton = () => {
  const { host, apiKey } = resolveMeiliConfig();
  return new Meilisearch({ host, apiKey });
};

type MeiliClientSingleton = ReturnType<typeof meiliClientSingleton>;

const globalForMeili = globalThis as typeof globalThis & {
  meili: MeiliClientSingleton | undefined;
};

// Singleton guarded on globalThis to survive Nuxt HMR (matches prisma.ts).
export const meili = globalForMeili.meili ?? meiliClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForMeili.meili = meili;
}
