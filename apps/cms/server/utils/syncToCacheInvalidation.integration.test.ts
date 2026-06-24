import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStorage, type Storage } from 'unstorage';
import redisDriver from 'unstorage/drivers/redis';
import { getTestRedisUrl } from '../../test/redisUrl';
import { createTaggedCache, type TaggedCache } from './taggedCache';
import { syncToCacheInvalidation } from './syncToCacheInvalidation';

// Real-Redis integration on DB 1 (see test/redisUrl.ts). Requires
// `docker compose up -d` (the redis sidecar). Mirrors taggedCache.integration.
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

describe('syncToCacheInvalidation (real Redis)', () => {
  it('ENTRY_PUBLISHED clears the content-type tag and the per-entry tag, leaving other types', async () => {
    await cache.set(
      'public:entries:Article:list',
      { n: 1 },
      { tags: ['content-type:Article'] }
    );
    await cache.set(
      'public:entries:Article:item:e1',
      { n: 2 },
      { tags: ['entry:Article:e1'] }
    );
    await cache.set(
      'public:entries:Page:list',
      { n: 3 },
      { tags: ['content-type:Page'] }
    );

    await syncToCacheInvalidation(
      { cache },
      {
        event: 'ENTRY_PUBLISHED',
        contentType: { id: 'ct1', identifier: 'Article' },
        entry: { id: 'e1' },
      }
    );

    expect(await cache.get('public:entries:Article:list')).toBeNull();
    expect(await cache.get('public:entries:Article:item:e1')).toBeNull();
    expect(await cache.get('public:entries:Page:list')).toEqual({ n: 3 });
  });

  it('CONTENT_TYPE_SCHEMA_CHANGED clears the content-type tag but NOT the per-entry tag', async () => {
    await cache.set(
      'public:entries:Article:list',
      { n: 1 },
      { tags: ['content-type:Article'] }
    );
    await cache.set(
      'public:entries:Article:item:e1',
      { n: 2 },
      { tags: ['entry:Article:e1'] }
    );

    await syncToCacheInvalidation(
      { cache },
      {
        event: 'CONTENT_TYPE_SCHEMA_CHANGED',
        contentTypeId: 'ct1',
        contentTypeIdentifier: 'Article',
      }
    );

    expect(await cache.get('public:entries:Article:list')).toBeNull();
    expect(await cache.get('public:entries:Article:item:e1')).toEqual({ n: 2 });
  });
});
