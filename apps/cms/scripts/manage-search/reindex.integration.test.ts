import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { runReindex, type ReindexLogger } from './reindex';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { meili } from '../../server/utils/meili';
import { resolveEntriesIndex } from '../../server/utils/searchIndex';
import {
  addTestDocuments,
  assertAttributeValues,
  assertDocumentExists,
  clearTestIndex,
  getAllDocuments,
} from '../../server/test/meiliTestUtils';
import type { SearchDocument } from '../../server/utils/searchDocument';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
const prisma = new PrismaClient({ adapter });
const index = meili.index<SearchDocument>(resolveEntriesIndex());

function makeLogger() {
  const lines: string[] = [];
  const logger: ReindexLogger = { info: (msg) => lines.push(msg) };
  return { logger, lines };
}

async function resetDb() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function createType(identifier: string, name: string): Promise<string> {
  const ct = await prisma.contentType.create({
    data: {
      identifier,
      name,
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
          {
            identifier: 'body',
            name: 'Body',
            type: FIELD_TYPES.TEXT,
            order: 1,
          },
        ],
      },
    },
  });
  return ct.id;
}

async function createPublishedEntry(
  contentTypeId: string,
  entryTitle: string,
  entryKey: string,
  body: string
) {
  return prisma.contentEntry.create({
    data: {
      contentTypeId,
      entryTitle,
      entryKey,
      slug: entryKey,
      versions: {
        create: {
          data: { title: entryTitle, body },
          entryTitle,
          status: CONTENT_STATUSES.PUBLISHED,
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    },
  });
}

describe('runReindex', () => {
  beforeEach(async () => {
    await resetDb();
    await clearTestIndex();
  });
  afterEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rebuilds the full index from current DB state', async () => {
    const articleId = await createType('Article', 'Article');
    const a1 = await createPublishedEntry(
      articleId,
      'First post',
      'first-post',
      'hello world'
    );
    const a2 = await createPublishedEntry(
      articleId,
      'Second post',
      'second-post',
      'more text'
    );

    const { logger } = makeLogger();
    const summary = await runReindex({ prisma, index, logger });

    expect(summary.total).toBe(2);
    expect(summary.byContentType).toEqual({ Article: 2 });

    const doc = await assertDocumentExists(a1.id);
    expect(doc.entryTitle).toBe('First post');
    expect(doc.fields.body).toBe('hello world');
    await assertAttributeValues(a1.id, {
      contentType: 'Article',
      entryKey: 'first-post',
    });

    const ids = (await getAllDocuments()).map((d) => d.id).sort();
    expect(ids).toEqual([a1.id, a2.id].sort());
  });

  it("reindexes only the named content type, leaving other types' documents", async () => {
    const pageDoc: SearchDocument = {
      id: 'page-0000-0000-0000-000000000000',
      entryKey: 'about',
      contentType: 'Page',
      entryTitle: 'About',
      publishedAt: null,
      fields: {},
    };
    await addTestDocuments([pageDoc]);

    const articleId = await createType('Article', 'Article');
    const a1 = await createPublishedEntry(
      articleId,
      'Scoped post',
      'scoped-post',
      'body'
    );

    const { logger } = makeLogger();
    const summary = await runReindex(
      { prisma, index, logger },
      { contentType: 'Article' }
    );

    expect(summary.total).toBe(1);
    expect(summary.byContentType).toEqual({ Article: 1 });

    const ids = (await getAllDocuments()).map((d) => d.id).sort();
    expect(ids).toEqual([a1.id, pageDoc.id].sort());
  });

  it('--dry-run reports counts and writes nothing', async () => {
    const articleId = await createType('Article', 'Article');
    await createPublishedEntry(articleId, 'Dry post', 'dry-post', 'body');

    const { logger, lines } = makeLogger();
    const summary = await runReindex(
      { prisma, index, logger },
      { dryRun: true }
    );

    expect(summary).toEqual({
      dryRun: true,
      total: 1,
      byContentType: { Article: 1 },
    });
    expect(await getAllDocuments()).toEqual([]);
    expect(
      lines.some((l) => l.includes('DRY RUN') && l.includes('1 entries'))
    ).toBe(true);
  });

  it('is idempotent — running twice yields the same documents', async () => {
    const articleId = await createType('Article', 'Article');
    const a1 = await createPublishedEntry(articleId, 'Once', 'once', 'body');

    const { logger } = makeLogger();
    await runReindex({ prisma, index, logger });
    await runReindex({ prisma, index, logger });

    const all = await getAllDocuments();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(a1.id);
  });

  it('reports progress per batch', async () => {
    const articleId = await createType('Article', 'Article');
    await createPublishedEntry(articleId, 'P1', 'p1', 'a');
    await createPublishedEntry(articleId, 'P2', 'p2', 'b');
    await createPublishedEntry(articleId, 'P3', 'p3', 'c');

    const { logger, lines } = makeLogger();
    await runReindex({ prisma, index, logger }, { batchSize: 1 });

    const progress = lines.filter((l) => l.includes('entries indexed'));
    expect(progress).toHaveLength(3);
    expect(progress[2]).toContain(
      '3 / 3 entries indexed (all types, 100% complete)'
    );
  });
});
