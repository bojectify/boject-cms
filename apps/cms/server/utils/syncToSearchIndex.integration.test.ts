import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { syncToSearchIndex } from './syncToSearchIndex';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { meili } from './meili';
import { resolveEntriesIndex } from './searchIndex';
import {
  addTestDocuments,
  assertAttributeValues,
  assertDocumentExists,
  clearTestIndex,
  getAllDocuments,
} from '../test/meiliTestUtils';
import type { SearchDocument } from './searchDocument';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
const prisma = new PrismaClient({ adapter });
const index = meili.index<SearchDocument>(resolveEntriesIndex());
const deps = { prisma, index };

async function resetDb() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function createType(identifier: string): Promise<string> {
  const ct = await prisma.contentType.create({
    data: {
      identifier,
      name: identifier,
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
  title: string,
  key: string,
  body: string
) {
  return prisma.contentEntry.create({
    data: {
      contentTypeId,
      entryTitle: title,
      entryKey: key,
      slug: key,
      versions: {
        create: {
          data: { title, body },
          entryTitle: title,
          status: CONTENT_STATUSES.PUBLISHED,
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    },
  });
}

function entryPayload(
  event: string,
  contentType: { id: string; identifier: string },
  entryId: string
) {
  return {
    event,
    deliveryId: 'd1',
    timestamp: '2026-01-01T00:00:00.000Z',
    contentType,
    entry: { id: entryId },
  };
}

describe('syncToSearchIndex', () => {
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

  it('ENTRY_PUBLISHED upserts the document', async () => {
    const ctId = await createType('Article');
    const e = await createPublishedEntry(ctId, 'Hello', 'hello', 'world');
    await syncToSearchIndex(
      deps,
      entryPayload('ENTRY_PUBLISHED', { id: ctId, identifier: 'Article' }, e.id)
    );

    const doc = await assertDocumentExists(e.id);
    expect(doc.entryTitle).toBe('Hello');
    await assertAttributeValues(e.id, {
      contentType: 'Article',
      entryKey: 'hello',
    });
    expect(doc.fields.body).toBe('world');
  });

  it('ENTRY_UNPUBLISHED deletes the document', async () => {
    const seeded: SearchDocument = {
      id: 'u1',
      entryKey: 'u1',
      contentType: 'Article',
      entryTitle: 'U',
      publishedAt: null,
      fields: {},
    };
    await addTestDocuments([seeded]);
    await syncToSearchIndex(
      deps,
      entryPayload(
        'ENTRY_UNPUBLISHED',
        { id: 'x', identifier: 'Article' },
        'u1'
      )
    );
    expect(await getAllDocuments()).toEqual([]);
  });

  it('ENTRY_DELETED deletes the document', async () => {
    const seeded: SearchDocument = {
      id: 'd9',
      entryKey: 'd9',
      contentType: 'Article',
      entryTitle: 'D',
      publishedAt: null,
      fields: {},
    };
    await addTestDocuments([seeded]);
    await syncToSearchIndex(
      deps,
      entryPayload('ENTRY_DELETED', { id: 'x', identifier: 'Article' }, 'd9')
    );
    expect(await getAllDocuments()).toEqual([]);
  });

  it('CONTENT_TYPE_SCHEMA_CHANGED reindexes every published entry of the type', async () => {
    const ctId = await createType('Article');
    const a = await createPublishedEntry(ctId, 'A', 'a', 'aa');
    const b = await createPublishedEntry(ctId, 'B', 'b', 'bb');
    await syncToSearchIndex(deps, {
      event: 'CONTENT_TYPE_SCHEMA_CHANGED',
      deliveryId: 'd2',
      contentTypeId: ctId,
      contentTypeIdentifier: 'Article',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    const ids = (await getAllDocuments()).map((d) => d.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it('ENTRY_PUBLISHED for an entry with no published version deletes any stale doc', async () => {
    const seeded: SearchDocument = {
      id: 'race1',
      entryKey: 'race1',
      contentType: 'Article',
      entryTitle: 'R',
      publishedAt: null,
      fields: {},
    };
    await addTestDocuments([seeded]);
    await syncToSearchIndex(
      deps,
      entryPayload(
        'ENTRY_PUBLISHED',
        { id: 'x', identifier: 'Article' },
        'race1'
      )
    );
    expect(await getAllDocuments()).toEqual([]);
  });
});
