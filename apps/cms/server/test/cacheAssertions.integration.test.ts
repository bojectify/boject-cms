import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { prisma } from '../utils/prisma';
import {
  assertCached,
  assertNotCached,
  assertTaggedWith,
  expectInvalidationOnEvent,
  clearTestCache,
  closeTestCache,
  getTestCache,
} from './cacheAssertions';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

describe('cache test harness (#262)', async () => {
  await setup({ dev: true });

  let IDENT: string;
  // Key + tag the server writes for the GET below (see entries.get.ts).
  let key: string;
  let tag: string;

  beforeAll(async () => {
    await clearTestCache();
    const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
    IDENT = `CacheProof${suffix}`;
    key = `public:entries:${IDENT}:perPage=10:after=`;
    tag = `content-type:${IDENT}`;

    const ct = await prisma.contentType.create({
      data: {
        name: `CacheProof_${suffix}`,
        identifier: IDENT,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: `Proof ${suffix}`,
        entryKey: `proof-${suffix}`,
        slug: `proof-${suffix}`,
        versions: {
          create: [
            {
              data: { title: `Proof ${suffix}` },
              entryTitle: `Proof ${suffix}`,
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await closeTestCache();
  });

  it('observes a server-written cache entry and its tag', async () => {
    // Cold GET → the handler caches the PUBLISHED-only page under `key`/`tag`.
    await fetch(`/api/public/entries?contentType=${IDENT}&perPage=10`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await assertCached(key);
    await assertTaggedWith(key, tag);
  });

  it('expectInvalidationOnEvent clears exactly the content-type tag', async () => {
    // Re-warm in case the previous test's entry was invalidated by ordering.
    await fetch(`/api/public/entries?contentType=${IDENT}&perPage=10`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await assertCached(key);

    await expectInvalidationOnEvent(
      { event: 'ENTRY_PUBLISHED', identifier: IDENT },
      [tag]
    );

    await assertNotCached(key);
  });

  it('getTestCache() exposes the shared handle the asserts read', async () => {
    const { cache, redis, storage } = getTestCache();
    await cache.set('__test_gtc_key', 'v', { tags: ['__test_gtc_tag'] });
    await assertCached('__test_gtc_key'); // internal-handle read sees the exposed-handle write
    expect(await storage.getItem('__test_gtc_key')).not.toBeNull();
    expect(
      await redis.sismember('__tagindex_p:__test_gtc_tag', '__test_gtc_key')
    ).toBe(1);
  });

  it('expectInvalidationOnEvent verifies a genuinely-surviving tag', async () => {
    // CONTENT_TYPE_SCHEMA_CHANGED clears content-type:<id> but NOT entry:<id>:*.
    await expectInvalidationOnEvent(
      { event: 'CONTENT_TYPE_SCHEMA_CHANGED', identifier: IDENT },
      [`content-type:${IDENT}`],
      [`entry:${IDENT}:e1`]
    );
  });

  it('expectInvalidationOnEvent throws if a "surviving" tag was actually cleared', async () => {
    // Non-vacuous proof of the survivors arg: content-type:<id> IS cleared by the
    // schema event, so claiming it survives must throw. Fails on a pre-param impl
    // that ignores the third argument (it would resolve without asserting).
    await expect(
      expectInvalidationOnEvent(
        { event: 'CONTENT_TYPE_SCHEMA_CHANGED', identifier: IDENT },
        [],
        [`content-type:${IDENT}`]
      )
    ).rejects.toThrow();
  });
});
