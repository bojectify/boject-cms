/**
 * Production fail-fast guard. Without REDIS_URL set, ioredis silently falls
 * back to localhost:6379, so a misconfigured prod deploy would quietly run
 * uncached and hammer Postgres — the exact thing the caching epic prevents.
 * Dev stays unguarded (local defaults are fine). Mirrors the
 * NUXT_SESSION_PASSWORD / MEILI_MASTER_KEY boot guards.
 */
export function assertCacheConfigured(env: {
  nodeEnv: string | undefined;
  redisUrl: string | undefined;
}): void {
  if (env.nodeEnv === 'production' && !env.redisUrl) {
    throw new Error(
      'REDIS_URL must be set in production — the public read cache requires Redis. ' +
        'Without it ioredis silently falls back to localhost:6379 and the app runs uncached.'
    );
  }
}

export const DEFAULT_PUBLIC_CACHE_TTL = 3600;

/**
 * Public read cache TTL in seconds. Tunable via BOJECT_PUBLIC_CACHE_TTL;
 * non-numeric / unset / ≤0 fall back to the default. Matches the
 * BOJECT_PUBLIC_RATE_LIMIT_RPM resolution convention. `raw` is injectable for
 * unit tests.
 */
export function resolvePublicCacheTtl(
  raw = process.env.BOJECT_PUBLIC_CACHE_TTL
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PUBLIC_CACHE_TTL;
}
