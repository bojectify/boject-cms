import type { Redis } from 'ioredis';
import type { Storage, StorageValue } from 'unstorage';

/** Reserved namespace for tag→key reverse-index sets. Cannot collide with real
 *  cache keys (e.g. `public:content:Article:…`). */
export const TAG_INDEX_PREFIX = '__tagindex:';

/**
 * Reverse-index for PERSISTENT (no-ttl) members. Never expires — only
 * invalidateByTag clears it. Kept separate from the TTL'd index (TAG_INDEX_PREFIX)
 * so a ttl'd write can never finite-ize a tag that has a persistent member, and
 * so a ttl'd-only index can still self-expire.
 */
export const TAG_INDEX_PERSISTENT_PREFIX = '__tagindex_p:';

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
        if (opts.ttl !== undefined) {
          // TTL'd member → the self-cleaning index. NX sets the TTL when the
          // set has none (first write / post-invalidation); GT only ever RAISES
          // it, so a later shorter-TTL write can't shorten the index below a
          // live member. This index holds ONLY ttl'd members, so NX can never
          // finite-ize a persistent tag — persistent members go to the index
          // below.
          const tagKey = TAG_INDEX_PREFIX + tag;
          pipeline.sadd(tagKey, key);
          pipeline.expire(tagKey, opts.ttl, 'NX');
          pipeline.expire(tagKey, opts.ttl, 'GT');
        } else {
          // Persistent member → a no-expiry index, so the value stays
          // invalidatable for as long as it's cached. Only invalidateByTag
          // clears it.
          pipeline.sadd(TAG_INDEX_PERSISTENT_PREFIX + tag, key);
        }
      }
      await pipeline.exec();
    },

    async get<T>(key: string) {
      return (await storage.getItem<T>(key)) ?? null;
    },

    async invalidateByTag(tag) {
      const ttlKey = TAG_INDEX_PREFIX + tag;
      const persistentKey = TAG_INDEX_PERSISTENT_PREFIX + tag;
      const [ttlMembers, persistentMembers] = await Promise.all([
        redis.smembers(ttlKey),
        redis.smembers(persistentKey),
      ]);
      // De-dup: a key tagged once with a ttl and once without appears in both.
      const members = [...new Set([...ttlMembers, ...persistentMembers])];
      // removeItem of an absent key is a no-op, so dangling members (from a key
      // also tagged elsewhere) are harmless.
      await Promise.all(members.map((member) => storage.removeItem(member)));
      await redis.del(ttlKey, persistentKey);
    },
  };
}
