import { expect } from 'vitest';
import { createStorage, type Storage } from 'unstorage';
import redisDriver from 'unstorage/drivers/redis';
import { Redis } from 'ioredis';
import {
  createTaggedCache,
  TAG_INDEX_PREFIX,
  TAG_INDEX_PERSISTENT_PREFIX,
  type TaggedCache,
} from '../utils/taggedCache';
import { syncToCacheInvalidation } from '../utils/syncToCacheInvalidation';
import {
  WEBHOOK_EVENTS,
  type WebhookEventName,
} from '../../utils/webhookEvents';
import { getTestRedisUrl } from '../../test/redisUrl';

/**
 * Cache test harness for the cms integration suite. Reads the SAME per-worker
 * test Redis DB the booted Nitro server writes — DB `1 + VITEST_POOL_ID` (DB 1
 * as the single-worker/globalSetup fallback), resolved via getTestRedisUrl(),
 * which vitest.config sets as REDIS_URL so the server inherits it. NO base: the
 * server's useStorage('cache') mount stores UNPREFIXED redis keys (unstorage
 * strips the mount prefix before the driver), so getItem(key) reads the raw
 * `<key>` the server wrote; the __tagindex:/__tagindex_p: sets are raw too, read
 * via the plain ioredis client. NEVER targets DB 0.
 */
const url = getTestRedisUrl();

let _storage: Storage | null = null;
let _redis: Redis | null = null;
let _cache: TaggedCache | null = null;

function handles(): { storage: Storage; redis: Redis; cache: TaggedCache } {
  if (!_storage) {
    _storage = createStorage({ driver: redisDriver({ url }) });
    _redis = new Redis(url);
    _cache = createTaggedCache({ storage: _storage, redis: _redis });
  }
  return { storage: _storage, redis: _redis!, cache: _cache! };
}

/** The shared, memoised per-worker test handle the assert helpers use. Lets
 *  callers act on cache (set / get / invalidateByTag) and read the raw
 *  tag-index sets without standing up their own ioredis/unstorage connection.
 *  Pair with closeTestCache() in afterAll. */
export function getTestCache(): {
  storage: Storage;
  redis: Redis;
  cache: TaggedCache;
} {
  return handles();
}

/** Assert the server cached a value under `key`. */
export async function assertCached(key: string): Promise<void> {
  const { storage } = handles();
  expect(
    await storage.getItem(key),
    `expected cache key "${key}" to be set`
  ).not.toBeNull();
}

/** Assert nothing is cached under `key`. */
export async function assertNotCached(key: string): Promise<void> {
  const { storage } = handles();
  expect(
    await storage.getItem(key),
    `expected cache key "${key}" to be absent`
  ).toBeNull();
}

/** Assert `key` is a member of `tag`'s reverse index (ttl'd or persistent). */
export async function assertTaggedWith(
  key: string,
  tag: string
): Promise<void> {
  const { redis } = handles();
  const [inTtl, inPersistent] = await Promise.all([
    redis.sismember(TAG_INDEX_PREFIX + tag, key),
    redis.sismember(TAG_INDEX_PERSISTENT_PREFIX + tag, key),
  ]);
  expect(
    inTtl === 1 || inPersistent === 1,
    `expected key "${key}" to be tagged with "${tag}"`
  ).toBe(true);
}

export interface CacheEventDescriptor {
  event: WebhookEventName;
  identifier: string;
  entryId?: string;
}

const CONTROL_TAG = '__test_control_tag';
const sentinelKey = (tag: string) => `__test_sentinel:${tag}`;

/**
 * Exercise the #261 cache-invalidation subscriber for `descriptor` and assert it
 * clears EXACTLY `expectedTagsCleared`. Seeds a sentinel under each expected tag
 * plus an unrelated control tag, runs the real syncToCacheInvalidation, then
 * asserts every expected sentinel is gone and the control survives (non-vacuous).
 * An optional `expectedTagsSurviving` list seeds a sentinel under each named tag
 * too and asserts it (like the control) is still present after the subscriber
 * runs — for asserting tags that must NOT be cleared by this event.
 */
export async function expectInvalidationOnEvent(
  descriptor: CacheEventDescriptor,
  expectedTagsCleared: string[],
  expectedTagsSurviving: string[] = []
): Promise<void> {
  const { cache } = handles();
  for (const tag of expectedTagsCleared) {
    await cache.set(sentinelKey(tag), '1', { tags: [tag] });
  }
  for (const tag of expectedTagsSurviving) {
    await cache.set(sentinelKey(tag), '1', { tags: [tag] });
  }
  await cache.set(sentinelKey(CONTROL_TAG), '1', { tags: [CONTROL_TAG] });

  const payload =
    descriptor.event === WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED
      ? {
          event: descriptor.event,
          contentTypeIdentifier: descriptor.identifier,
        }
      : {
          event: descriptor.event,
          contentType: { identifier: descriptor.identifier },
          ...(descriptor.entryId ? { entry: { id: descriptor.entryId } } : {}),
        };

  await syncToCacheInvalidation({ cache }, payload);

  for (const tag of expectedTagsCleared) {
    await assertNotCached(sentinelKey(tag));
  }
  for (const tag of expectedTagsSurviving) {
    await assertCached(sentinelKey(tag));
  }
  await assertCached(sentinelKey(CONTROL_TAG));
}

/** Per-file reset — flush the per-worker test Redis DB. Call in beforeEach/beforeAll. */
export async function clearTestCache(): Promise<void> {
  const { redis } = handles();
  await redis.flushdb();
}

/** Close the test Redis client. Call in afterAll. */
export async function closeTestCache(): Promise<void> {
  if (_redis) {
    await _redis.quit();
  }
  _redis = null;
  _storage = null;
  _cache = null;
}
