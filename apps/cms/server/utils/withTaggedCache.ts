import { setResponseHeader, type H3Event } from 'h3';
import { taggedCache, type TaggedCache } from './taggedCache';

export interface WithTaggedCacheOptions {
  key: string;
  tags: string[];
  ttl: number; // seconds
}

/**
 * Cache-aside wrapper over the tagged cache primitive. Caching is a perf
 * optimisation, never a correctness dependency: a cache read error serves the
 * origin (BYPASS) and a write error is best-effort (still served, MISS) — never
 * a 500. `cache` is injected (default the prod singleton) so unit tests drive
 * HIT/MISS/BYPASS without Nitro. `setResponseHeader` is imported from h3
 * explicitly so the wrapper runs against an h3 event stub. Reused by #260
 * (GraphQL) and the future single-entry endpoint — each caller supplies its own
 * key/tags.
 */
export async function withTaggedCache<T>(
  event: H3Event,
  opts: WithTaggedCacheOptions,
  fn: () => Promise<T>,
  cache: TaggedCache = taggedCache
): Promise<T> {
  let cached: T | null;
  try {
    cached = await cache.get<T>(opts.key);
  } catch (err) {
    console.warn('[cache] get failed, serving from origin', err);
    setResponseHeader(event, 'X-Cache', 'BYPASS');
    return fn();
  }

  if (cached !== null && cached !== undefined) {
    setResponseHeader(event, 'X-Cache', 'HIT');
    return cached;
  }

  const result = await fn();
  try {
    await cache.set(opts.key, result, { tags: opts.tags, ttl: opts.ttl });
  } catch (err) {
    console.warn('[cache] set failed (best-effort)', err); // result still served
  }
  setResponseHeader(event, 'X-Cache', 'MISS');
  return result;
}
