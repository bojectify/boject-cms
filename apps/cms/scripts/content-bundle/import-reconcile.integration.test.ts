// import-reconcile.integration.test.ts
//
// DB-backed + Redis + Meilisearch integration test proving that importBundle
// fires CONTENT_BULK_SYNC deliveries for types with created/updated entries,
// enabling search + cache reconciliation (#393).
//
// Does NOT boot a Nuxt dev server. Uses direct Prisma + Redis + Meili clients
// to keep the test fast and independent. The worker is driven manually via
// runWorkerTick with the real internal handlers wired to the same backing
// stores the booted server would use (Redis DB 1, entries_test Meili index).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { createStorage } from 'unstorage';
import redisDriver from 'unstorage/drivers/redis';
import { Redis } from 'ioredis';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { getTestRedisUrl } from '../../test/redisUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import { WEBHOOK_EVENTS } from '../../utils/webhookEvents';
import { importBundle } from './import';
import { makeBundle, entry, version } from './bundleFactories';
import {
  ensureSearchSyncWebhook,
  SEARCH_SYNC_WEBHOOK_NAME,
} from '../../server/utils/ensureSearchSyncWebhook';
import {
  ensureCacheInvalidationWebhook,
  CACHE_INVALIDATION_WEBHOOK_NAME,
} from '../../server/utils/ensureCacheInvalidationWebhook';
import { runWorkerTick } from '../../server/utils/webhookWorker';
import { syncToSearchIndex } from '../../server/utils/syncToSearchIndex';
import { syncToCacheInvalidation } from '../../server/utils/syncToCacheInvalidation';
import { meili } from '../../server/utils/meili';
import { resolveEntriesIndex } from '../../server/utils/searchIndex';
import type { SearchDocument } from '../../server/utils/searchDocument';
import { searchDocId } from '../../server/utils/searchDocument';
import { createTaggedCache } from '../../server/utils/taggedCache';
import {
  clearTestIndex,
  assertDocumentExists,
  waitForIndexing,
} from '../../server/test/meiliTestUtils';
import {
  clearTestCache,
  closeTestCache,
  assertCached,
  assertNotCached,
} from '../../server/test/cacheAssertions';

// ── shared handles ────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getTestDatabaseUrl() }),
});
const index = meili.index<SearchDocument>(resolveEntriesIndex());

const redisUrl = getTestRedisUrl();
let storage: ReturnType<typeof createStorage>;
let redis: Redis;
let cache: ReturnType<typeof createTaggedCache>;

// ── per-suite type ────────────────────────────────────────────────────────────

let IDENTIFIER: string;
let contentTypeId: string;

// ── helpers ───────────────────────────────────────────────────────────────────

async function resetDb() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

/** Tick the worker once with the real internal handlers. */
async function tick() {
  await runWorkerTick({
    prisma: prisma as never,
    fetch: fetch as never,
    now: () => new Date(),
    internalHandlers: {
      [SEARCH_SYNC_WEBHOOK_NAME]: (payload) =>
        syncToSearchIndex({ prisma, index }, payload),
      [CACHE_INVALIDATION_WEBHOOK_NAME]: (payload) =>
        syncToCacheInvalidation({ cache }, payload),
    },
  });
}

// ── suite setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Redis + tagged-cache
  storage = createStorage({ driver: redisDriver({ url: redisUrl }) });
  redis = new Redis(redisUrl);
  cache = createTaggedCache({ storage, redis });

  await clearTestCache();
  await clearTestIndex();
  await resetDb();

  // The seed-internal-webhooks.ts Nitro plugin is skipped when VITEST=true, so
  // we seed the INTERNAL webhooks directly into boject_test. Without them,
  // insertDeliveries finds no subscribers and enqueues 0 rows.
  await ensureSearchSyncWebhook(prisma as never);
  await ensureCacheInvalidationWebhook(prisma as never);

  // Content type T: ENTRY_TITLE `title` + TEXT `body` — created directly
  // (not via importBundle) so the schema-create path is separate from the
  // entry-import path we are testing here.
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  IDENTIFIER = `ImportReconcile${suffix}`;

  const ct = await prisma.contentType.create({
    data: {
      identifier: IDENTIFIER,
      name: IDENTIFIER,
      description: null,
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            unique: true,
            order: 0,
          },
          {
            identifier: 'body',
            name: 'Body',
            type: FIELD_TYPES.TEXT,
            required: false,
            unique: false,
            order: 1,
          },
        ],
      },
    },
  });
  contentTypeId = ct.id;
});

afterAll(async () => {
  await resetDb();
  // Remove INTERNAL webhook rows seeded above — they are not seeded by the
  // vitest globalSetup (the Nitro plugin is VITEST-skipped), so leaving them
  // would leak into later integration files.
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhook.deleteMany({ where: { kind: 'INTERNAL' } });
  await prisma.$disconnect();
  await redis.quit();
  await storage.dispose();
  await closeTestCache();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('importBundle — reconcile (#393)', () => {
  it('creates entries: enqueues CONTENT_BULK_SYNC; worker clears cache + reindexes Meili', async () => {
    // Warm the public-entries cache at the canonical key for T.
    // Tag it with content-type:${IDENTIFIER} so the cache-invalidation
    // subscriber can clear it via invalidateByTag.
    const cacheKey = `public:entries:${IDENTIFIER}:perPage=10:after=`;
    await cache.set(
      cacheKey,
      { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
      { tags: [`content-type:${IDENTIFIER}`] }
    );
    await assertCached(cacheKey);

    // Import a bundle with two PUBLISHED entries of type T.
    const importBundlePayload = makeBundle({
      entries: [
        entry(IDENTIFIER, 'entry-one', {
          entryTitle: 'Entry One',
          slug: 'entry-one',
          versions: [
            version(CONTENT_STATUSES.PUBLISHED, {
              data: { title: 'Entry One', body: 'Hello' },
              publishedAt: new Date().toISOString(),
            }),
          ],
        }),
        entry(IDENTIFIER, 'entry-two', {
          entryTitle: 'Entry Two',
          slug: 'entry-two',
          versions: [
            version(CONTENT_STATUSES.PUBLISHED, {
              data: { title: 'Entry Two', body: 'World' },
              publishedAt: new Date().toISOString(),
            }),
          ],
        }),
      ],
    });

    const result = await importBundle(prisma, importBundlePayload, {
      mode: 'entries',
    });
    expect(result.entriesCreated).toBe(2);

    // CONTENT_BULK_SYNC was enqueued once (coalesced — 2 entries, 1 type).
    // insertDeliveries creates one row per subscriber, so with 2 internal
    // webhooks (search sync + cache invalidation) we get exactly 2 rows.
    const deliveryCount = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });
    // 1 affected type × 2 internal subscribers = 2 (per-entry bug would be 2 entries × 2 = 4)
    expect(deliveryCount).toBe(2);

    // Drive the worker. Both INTERNAL webhooks (search sync + cache invalidation)
    // subscribe to CONTENT_BULK_SYNC, so a single tick processes both.
    await tick();
    await waitForIndexing();

    // Cache cleared: the cache-invalidation subscriber fired invalidateByTag on
    // content-type:${IDENTIFIER}, removing the warmed key.
    await assertNotCached(cacheKey);

    // Meili reindexed: the search-sync subscriber called syncToSearchIndex with
    // CONTENT_BULK_SYNC, which re-read T's entries and upserted docs.
    const entryOne = await prisma.contentEntry.findFirst({
      where: { contentTypeId, entryKey: 'entry-one' },
    });
    const entryTwo = await prisma.contentEntry.findFirst({
      where: { contentTypeId, entryKey: 'entry-two' },
    });
    expect(entryOne).not.toBeNull();
    expect(entryTwo).not.toBeNull();
    await assertDocumentExists(searchDocId(entryOne!.id, 'PUBLISHED'));
    await assertDocumentExists(searchDocId(entryTwo!.id, 'PUBLISHED'));

    // All CONTENT_BULK_SYNC deliveries for T are SUCCESS.
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((d) => d.status === 'SUCCESS')).toBe(true);
  });

  it('dry-run: importBundle commits zero CONTENT_BULK_SYNC rows (tx rolled back)', async () => {
    // Count existing deliveries for T (set by the previous test).
    const countBefore = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });

    // A bundle that would add entries to T — but dryRun rolls back everything.
    const dryRunBundle = makeBundle({
      entries: [
        entry(IDENTIFIER, 'entry-dry', {
          entryTitle: 'Entry Dry',
          slug: 'entry-dry',
          versions: [
            version(CONTENT_STATUSES.PUBLISHED, {
              data: { title: 'Entry Dry', body: 'Dry run' },
              publishedAt: new Date().toISOString(),
            }),
          ],
        }),
      ],
    });

    const dryResult = await importBundle(prisma, dryRunBundle, {
      mode: 'entries',
      dryRun: true,
    });
    // The planner reports what WOULD be created, but nothing was committed.
    expect(dryResult.entriesCreated).toBe(1);

    const countAfter = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });
    // The tx rolled back: zero NEW delivery rows committed.
    expect(countAfter).toBe(countBefore);

    // Confirm the dry-run entry is NOT in the DB.
    const dryEntry = await prisma.contentEntry.findFirst({
      where: { contentTypeId, entryKey: 'entry-dry' },
    });
    expect(dryEntry).toBeNull();
  });

  it('coalescing: importing N>1 entries of ONE type commits exactly ONE CONTENT_BULK_SYNC row', async () => {
    const countBefore = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });

    // Bundle with three new entries of type T — should still produce ONE delivery.
    const coalesceBundle = makeBundle({
      entries: [
        entry(IDENTIFIER, 'entry-coalesce-a', {
          entryTitle: 'Coalesce A',
          versions: [
            version(CONTENT_STATUSES.DRAFT, {
              data: { title: 'Coalesce A', body: 'Alpha' },
            }),
          ],
        }),
        entry(IDENTIFIER, 'entry-coalesce-b', {
          entryTitle: 'Coalesce B',
          versions: [
            version(CONTENT_STATUSES.DRAFT, {
              data: { title: 'Coalesce B', body: 'Beta' },
            }),
          ],
        }),
        entry(IDENTIFIER, 'entry-coalesce-c', {
          entryTitle: 'Coalesce C',
          versions: [
            version(CONTENT_STATUSES.DRAFT, {
              data: { title: 'Coalesce C', body: 'Gamma' },
            }),
          ],
        }),
      ],
    });

    const result = await importBundle(prisma, coalesceBundle, {
      mode: 'entries',
    });
    expect(result.entriesCreated).toBe(3);

    const countAfter = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_BULK_SYNC,
        contentTypeId,
      },
    });

    // Exactly ONE enqueueContentBulkSync call: one per type, not per entry.
    // With 2 internal subscribers the row delta is 2 (not 3 × 2 = 6).
    // Assert delta > 0 (something was enqueued) and < 3 (not one per entry).
    const delta = countAfter - countBefore;
    // 1 enqueue × 2 subscribers = 2 rows (coalesced); 3 entries × 2 = 6 if per-entry. delta in (0,3) proves coalesced.
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(3);
  });
});
