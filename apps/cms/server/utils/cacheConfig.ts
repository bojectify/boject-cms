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

export const DEFAULT_GRAPHQL_CACHE_MAX_BYTES = 1_048_576; // 1 MiB

/**
 * Max serialized size of a cached GraphQL response. Larger responses skip the
 * cache (a single accidental mega-query must not evict the working set or
 * bloat Redis). Tunable via BOJECT_GRAPHQL_CACHE_MAX_BYTES; non-numeric /
 * unset / ≤0 fall back to the default. Same resolution convention as
 * resolvePublicCacheTtl.
 */
export function resolveGraphqlCacheMaxBytes(
  raw = process.env.BOJECT_GRAPHQL_CACHE_MAX_BYTES
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GRAPHQL_CACHE_MAX_BYTES;
}
