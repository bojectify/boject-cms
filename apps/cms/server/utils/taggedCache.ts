import type { Redis } from 'ioredis';
import type { Storage, StorageValue } from 'unstorage';

/** Reserved namespace for tag→key reverse-index sets. Cannot collide with real
 *  cache keys (e.g. `public:content:Article:…`). */
export const TAG_INDEX_PREFIX = '__tagindex:';

export interface SetOptions {
  /** Tags this value depends on; `invalidateByTag` of any clears this key. */
  tags: string[];
  /** Optional TTL in seconds. Absent ⇒ persistent value + persistent index. */
  ttl?: number;
}

export interface TaggedCache {
  set(key: string, value: unknown, opts: SetOptions): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  invalidateByTag(tag: string): Promise<void>;
}

export interface TaggedCacheDeps {
  /** unstorage handle for values (prod: `useStorage('cache')`). */
  storage: Storage;
  /** ioredis instance backing the same mount/DB (prod: the driver's own client). */
  redis: Redis;
}

/**
 * Build a tagged cache over a value store (unstorage) + a raw ioredis client
 * for native set ops. Storage-agnostic and constructible outside Nitro, so it
 * is tested directly against real Redis (like `syncToSearchIndex`). The prod
 * singleton (below) wires the Nitro deps.
 */
export function createTaggedCache(deps: TaggedCacheDeps): TaggedCache {
  const { storage, redis } = deps;

  return {
    async set(key, value, opts) {
      // Value first: a crash before the tags pipeline leaves an
      // un-invalidatable-but-correct value, never a tag pointing at nothing.
      await storage.setItem(key, value as StorageValue, { ttl: opts.ttl });

      if (opts.tags.length === 0) return;

      const pipeline = redis.pipeline();
      for (const tag of opts.tags) {
        const tagKey = TAG_INDEX_PREFIX + tag;
        pipeline.sadd(tagKey, key);
        // Two-flag strategy: NX sets the TTL when the key has none (first write
        // or after invalidation); GT only RAISES it — so a later short-TTL
        // write to the same tag can never shorten the index below an existing
        // member's life. Redis treats -1 (no expiry) as infinity for GT, so GT
        // alone fails on a key without an existing TTL.
        // No value TTL ⇒ no EXPIRE ⇒ the index stays persistent.
        if (opts.ttl !== undefined) {
          pipeline.expire(tagKey, opts.ttl, 'NX');
          pipeline.expire(tagKey, opts.ttl, 'GT');
        }
      }
      await pipeline.exec();
    },

    async get<T>(key: string) {
      return (await storage.getItem<T>(key)) ?? null;
    },

    async invalidateByTag(tag) {
      const tagKey = TAG_INDEX_PREFIX + tag;
      const members = await redis.smembers(tagKey);
      // removeItem of an absent key is a no-op, so dangling members (from a key
      // also tagged elsewhere) are harmless.
      await Promise.all(members.map((member) => storage.removeItem(member)));
      await redis.del(tagKey);
    },
  };
}
