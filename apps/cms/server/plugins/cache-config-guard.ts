import { assertCacheConfigured } from '../utils/cacheConfig';

// Imported explicitly (not auto-imported): Nuxt server auto-imports do not
// reliably resolve inside defineNitroPlugin callbacks in the production bundle
// (same reason search-index-bootstrap.ts / webhook-worker.ts import directly).
export default defineNitroPlugin(() => {
  // Skip in test mode: the integration suite boots a dev Nitro server without a
  // production env, and the guard's logic is unit-tested via
  // assertCacheConfigured. Dev (`pnpm dev`) and production still run the guard.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }

  // Fail-fast: throwing here aborts boot — the misconfig signal we want. In
  // production an unset REDIS_URL would otherwise let ioredis fall back to
  // localhost:6379 and the app would run uncached against Postgres.
  assertCacheConfigured({
    nodeEnv: process.env.NODE_ENV,
    redisUrl: process.env.REDIS_URL,
  });
});
