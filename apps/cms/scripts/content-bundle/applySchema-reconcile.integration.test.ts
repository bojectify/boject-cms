// applySchema-reconcile.integration.test.ts
//
// DB-backed + Redis + Meilisearch integration test proving that
// applySchema fires CONTENT_TYPE_SCHEMA_CHANGED deliveries for existing
// types whose fields changed, enabling search + cache reconciliation (#393).
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
import { applySchema } from './applySchema';
import type { Bundle } from './types';
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

// ── per-suite type + entry ────────────────────────────────────────────────────

let IDENTIFIER: string;
let contentTypeId: string;
let entryId: string;

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

  // Content type T: ENTRY_TITLE `title` + TEXT `body`
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  IDENTIFIER = `Reconcile${suffix}`;

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

  // One PUBLISHED entry
  const entry = await prisma.contentEntry.create({
    data: {
      contentTypeId,
      entryTitle: 'Entry A',
      entryKey: 'entry-a',
      slug: 'entry-a',
      versions: {
        create: {
          data: { title: 'Entry A', body: 'Hello world' },
          entryTitle: 'Entry A',
          status: CONTENT_STATUSES.PUBLISHED,
          publishedAt: new Date(),
        },
      },
    },
  });
  entryId = entry.id;
});

afterAll(async () => {
  await resetDb();
  // Remove INTERNAL webhook rows seeded by ensureSearchSyncWebhook /
  // ensureCacheInvalidationWebhook above — they are not seeded by the
  // vitest globalSetup (the Nitro plugin is VITEST-skipped), so leaving
  // them would leak into later integration files (e.g. webhooks.test.ts).
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhook.deleteMany({ where: { kind: 'INTERNAL' } });
  await prisma.$disconnect();
  await redis.quit();
  await storage.dispose();
  await closeTestCache();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('applySchema — reconcile (#393)', () => {
  it('field-add on existing type: enqueues CONTENT_TYPE_SCHEMA_CHANGED; worker clears cache + reindexes Meili', async () => {
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

    // Seed the entry into the Meili test index so we can verify reindexing.
    await syncToSearchIndex(
      { prisma, index },
      {
        event: WEBHOOK_EVENTS.ENTRY_PUBLISHED,
        deliveryId: 'seed',
        timestamp: new Date().toISOString(),
        contentType: { id: contentTypeId, identifier: IDENTIFIER },
        entry: { id: entryId },
      }
    );
    await waitForIndexing();
    await assertDocumentExists(searchDocId(entryId, 'PUBLISHED'));

    // Apply schema: add a `subtitle` TEXT field to the existing type T.
    // plan.fields.create has one entry for T (existing, not in plan.contentTypes.create)
    // → collectFieldChangedTypes returns [{id: contentTypeId, identifier: IDENTIFIER}]
    // → enqueueContentTypeSchemaChanged fires for T inside the tx
    const fieldAddBundle: Bundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: IDENTIFIER,
          name: IDENTIFIER,
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'body',
              name: 'Body',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
            {
              id: null,
              identifier: 'subtitle',
              name: 'Subtitle',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 2,
              options: null,
            },
          ],
        },
      ],
    };

    const result = await applySchema(prisma, fieldAddBundle);
    expect(result.applied.fieldsCreated).toBe(1);

    // Drive the worker with a bounded drain loop. Both INTERNAL webhooks (search
    // sync + cache invalidation) subscribe to CONTENT_TYPE_SCHEMA_CHANGED.
    // Under full-suite load a delivery can take a retry (transient FAILED →
    // backoff ~1 s → SUCCESS); a single tick() would race that. Loop until all
    // of this test's deliveries reach SUCCESS, or up to 20 iterations (max
    // ~24 s — hit only if every attempt fails, which would surface as a loud
    // assertion failure below).
    {
      const MAX_DRAIN_ITERS = 20;
      for (let i = 0; i < MAX_DRAIN_ITERS; i++) {
        await tick();
        const pending = await prisma.webhookDelivery.findMany({
          where: {
            event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
            contentTypeId,
          },
        });
        if (
          pending.length > 0 &&
          pending.every((d) => d.status === 'SUCCESS')
        ) {
          break;
        }
        // Backoff for attempt 1 is 1 s; wait long enough for the retry row to
        // become eligible before the next tick picks it up.
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    await waitForIndexing();

    // Cache cleared: the cache-invalidation subscriber fired invalidateByTag on
    // content-type:${IDENTIFIER}, removing the warmed key.
    await assertNotCached(cacheKey);

    // Meili reindexed: the search-sync subscriber called syncToSearchIndex with
    // CONTENT_TYPE_SCHEMA_CHANGED, which re-read T's entries and upserted docs.
    await assertDocumentExists(searchDocId(entryId, 'PUBLISHED'));

    // All CONTENT_TYPE_SCHEMA_CHANGED deliveries for T are SUCCESS.
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
        contentTypeId,
      },
    });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((d) => d.status === 'SUCCESS')).toBe(true);
  });

  it('dry-run: applySchema commits zero CONTENT_TYPE_SCHEMA_CHANGED rows (tx rolled back)', async () => {
    // Count existing deliveries for T (set by the previous test).
    const countBefore = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
        contentTypeId,
      },
    });

    // A bundle that would add `excerpt` to T — but dryRun rolls back everything.
    // After the previous test, T has title+body+subtitle; this adds excerpt.
    const dryRunBundle: Bundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: IDENTIFIER,
          name: IDENTIFIER,
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'body',
              name: 'Body',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
            {
              id: null,
              identifier: 'subtitle',
              name: 'Subtitle',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 2,
              options: null,
            },
            {
              id: null,
              identifier: 'excerpt',
              name: 'Excerpt',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 3,
              options: null,
            },
          ],
        },
      ],
    };

    const dryResult = await applySchema(prisma, dryRunBundle, { dryRun: true });
    // Plan shows excerpt would be created, but nothing was committed.
    expect(dryResult.applied.fieldsCreated).toBe(1);

    const countAfter = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
        contentTypeId,
      },
    });
    // The tx rolled back: zero NEW delivery rows committed.
    expect(countAfter).toBe(countBefore);
  });

  it('create-only: applySchema enqueues zero CONTENT_TYPE_SCHEMA_CHANGED rows for the new type', async () => {
    const newSuffix = randomUUID().slice(0, 8).replace(/-/g, '');
    const newIdentifier = `NewOnly${newSuffix}`;

    // Bundle: T (no-op — matches DB state) + a brand-new type.
    // plan.contentTypes.create = [newType]; plan.fields.create = []
    // collectFieldChangedTypes: created = {newIdentifier}; no field ops on T
    // → returns [] → 0 enqueues.
    const createOnlyBundle: Bundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: IDENTIFIER,
          name: IDENTIFIER,
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'body',
              name: 'Body',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
            {
              id: null,
              identifier: 'subtitle',
              name: 'Subtitle',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 2,
              options: null,
            },
          ],
        },
        {
          id: null,
          identifier: newIdentifier,
          name: newIdentifier,
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };

    const createResult = await applySchema(prisma, createOnlyBundle);
    expect(createResult.applied.contentTypesCreated).toBe(1);
    expect(createResult.applied.fieldsCreated).toBe(0); // new type's fields rode Pass 1

    // Look up the new type's ID to scope the delivery count assertion.
    const newCt = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: newIdentifier },
    });

    // Brand-new types have no entries → no search docs / cache entries to
    // reconcile → collectFieldChangedTypes excluded them → 0 deliveries.
    const deliveriesForNewType = await prisma.webhookDelivery.count({
      where: {
        event: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
        contentTypeId: newCt.id,
      },
    });
    expect(deliveriesForNewType).toBe(0);

    // Tidy: remove the new type so subsequent runs stay clean.
    await prisma.contentType.delete({ where: { id: newCt.id } });
  });
});
