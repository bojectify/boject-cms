import { afterAll, beforeEach, describe, it } from 'vitest';
import {
  clearTestCache,
  closeTestCache,
  expectInvalidationOnEvent,
} from '../test/cacheAssertions';

// Real-Redis integration on the per-worker test DB (1 + VITEST_POOL_ID; DB 1 as
// the single-worker fallback), via the shared #262 harness. Requires
// `docker compose up -d` (the redis sidecar).

beforeEach(async () => {
  await clearTestCache();
});

afterAll(async () => {
  await closeTestCache();
});

describe('syncToCacheInvalidation (real Redis)', () => {
  it('ENTRY_PUBLISHED clears the content-type + per-entry tags, leaving other types', async () => {
    await expectInvalidationOnEvent(
      { event: 'ENTRY_PUBLISHED', identifier: 'Article', entryId: 'e1' },
      ['content-type:Article', 'entry:Article:e1'],
      ['content-type:Page']
    );
  });

  it('CONTENT_TYPE_SCHEMA_CHANGED clears the content-type tag but NOT the per-entry tag', async () => {
    await expectInvalidationOnEvent(
      { event: 'CONTENT_TYPE_SCHEMA_CHANGED', identifier: 'Article' },
      ['content-type:Article'],
      ['entry:Article:e1']
    );
  });
});
