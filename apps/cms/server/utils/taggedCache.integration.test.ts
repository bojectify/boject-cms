import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStorage, type Storage } from 'unstorage';
import redisDriver from 'unstorage/drivers/redis';
import { getTestRedisUrl } from '../../test/redisUrl';
import { createTaggedCache, type TaggedCache } from './taggedCache';

// Real-Redis integration test on DB 1 (see test/redisUrl.ts). Builds a
// standalone unstorage redis handle (values) + a matching ioredis (tag sets +
// assertions), mirroring how prod wires useStorage('cache') + getInstance().
// Requires `docker compose up -d` (the redis sidecar).
const url = getTestRedisUrl();

let storage: Storage;
let redis: Redis;
let cache: TaggedCache;

beforeAll(() => {
  storage = createStorage({ driver: redisDriver({ url }) });
  redis = new Redis(url);
  cache = createTaggedCache({ storage, redis });
});

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
  await storage.dispose();
});

describe('createTaggedCache', () => {
  it('round-trips an object value through set/get', async () => {
    await cache.set(
      'public:Article:slug',
      { title: 'Hi', n: 7 },
      { tags: ['a'] }
    );
    expect(await cache.get('public:Article:slug')).toEqual({
      title: 'Hi',
      n: 7,
    });
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('nope')).toBeNull();
  });

  it('invalidateByTag removes every key written with that tag', async () => {
    await cache.set('a', { n: 1 }, { tags: ['type:Article'] });
    await cache.set('b', { n: 2 }, { tags: ['type:Article'] });
    await cache.set('c', { n: 3 }, { tags: ['type:Page'] });

    await cache.invalidateByTag('type:Article');

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).toEqual({ n: 3 });
    // The reverse index for the invalidated tag is gone too.
    expect(await redis.exists('__tagindex_p:type:Article')).toBe(0);
  });

  it('keeps the tag-set TTL >= the value TTL and never lowers it (EXPIRE GT)', async () => {
    await cache.set('k1', { v: 1 }, { tags: ['t'], ttl: 100 });
    const ttlAfterFirst = await redis.ttl('__tagindex:t');
    expect(ttlAfterFirst).toBeGreaterThan(0);
    expect(ttlAfterFirst).toBeLessThanOrEqual(100);

    // A second, shorter-TTL write under the same tag must NOT lower the set TTL.
    await cache.set('k2', { v: 2 }, { tags: ['t'], ttl: 10 });
    const ttlAfterSecond = await redis.ttl('__tagindex:t');
    expect(ttlAfterSecond).toBeGreaterThan(10);
  });

  it('puts a no-TTL value in the persistent index (no expiry, separate key)', async () => {
    await cache.set('persist', { v: 1 }, { tags: ['p'] });
    // No ttl'd index is created; the member lives in the persistent index.
    expect(await redis.exists('__tagindex:p')).toBe(0);
    expect(await redis.ttl('__tagindex_p:p')).toBe(-1); // -1 = exists, no expiry
  });

  it('a tag with both persistent and TTL-d members: invalidate clears both indexes', async () => {
    await cache.set('p1', { v: 1 }, { tags: ['mix'] }); // persistent
    await cache.set('t1', { v: 2 }, { tags: ['mix'], ttl: 100 }); // ttl'd

    await cache.invalidateByTag('mix');

    expect(await cache.get('p1')).toBeNull();
    expect(await cache.get('t1')).toBeNull();
    expect(await redis.exists('__tagindex:mix')).toBe(0);
    expect(await redis.exists('__tagindex_p:mix')).toBe(0);
  });

  it('a TTL-d write never finite-izes a tag that has a persistent member', async () => {
    await cache.set('p1', { v: 1 }, { tags: ['mix'] }); // persistent index, no expiry
    await cache.set('t1', { v: 2 }, { tags: ['mix'], ttl: 5 }); // ttl'd index, TTL 5

    // The persistent index must remain expiry-free; only the ttl'd index is finite.
    expect(await redis.ttl('__tagindex_p:mix')).toBe(-1);
    expect(await redis.ttl('__tagindex:mix')).toBeGreaterThan(0);
  });

  it('lets a short-TTL value expire out of the cache', async () => {
    await cache.set('short', { v: 1 }, { tags: ['s'], ttl: 1 });
    expect(await cache.get('short')).toEqual({ v: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await cache.get('short')).toBeNull();
  });

  it('a key under two tags: invalidating one removes it; the other is a harmless no-op', async () => {
    await cache.set('multi', { v: 1 }, { tags: ['t1', 't2'] });

    await cache.invalidateByTag('t1');
    expect(await cache.get('multi')).toBeNull();

    // t2 still lists 'multi' as a dangling member; invalidating it must not throw.
    await expect(cache.invalidateByTag('t2')).resolves.toBeUndefined();
    expect(await cache.get('multi')).toBeNull();
  });

  it('concurrent writes to the same key under different tags keep all tags', async () => {
    await Promise.all([
      cache.set('shared', { w: 'a' }, { tags: ['ta'] }),
      cache.set('shared', { w: 'b' }, { tags: ['tb'] }),
    ]);

    // Last-write-wins on the value; both tag sets reference the key.
    const v = await cache.get<{ w: string }>('shared');
    expect(['a', 'b']).toContain(v?.w);

    // Either tag can invalidate the surviving value.
    await cache.invalidateByTag('ta');
    expect(await cache.get('shared')).toBeNull();
  });

  it('set with no tags writes the value and creates no tag index', async () => {
    await cache.set('untagged', { v: 1 }, { tags: [] });
    expect(await cache.get('untagged')).toEqual({ v: 1 });
    const keys = await redis.keys('__tagindex:*');
    expect(keys).toEqual([]);
  });
});
