import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { syncToSearchIndex } from './syncToSearchIndex';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { meili } from './meili';
import { resolveEntriesIndex } from './searchIndex';
import {
  addTestDocuments,
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
          { identifier: 'title', name: 'Title', type: FIELD_TYPES.ENTRY_TITLE, required: true, order: 0 },
          { identifier: 'body', name: 'Body', type: FIELD_TYPES.TEXT, order: 1 },
        ],
      },
    },
  });
  return ct.id;
}

/** Create an entry with the given version statuses (data per status). */
async function createEntry(
  contentTypeId: string,
  key: string,
  versions: { status: string; title: string; body: string; publishedAt?: Date }[]
) {
  return prisma.contentEntry.create({
    data: {
      contentTypeId,
      entryTitle: versions[0]!.title,
      entryKey: key,
      slug: key,
      versions: {
        create: versions.map((v) => ({
          data: { title: v.title, body: v.body },
          entryTitle: v.title,
          status: v.status as never,
          publishedAt: v.publishedAt ?? null,
        })),
      },
    },
  });
}

function entryPayload(
  event: string,
  contentType: { id: string; identifier: string },
  entryId: string
) {
  return { event, deliveryId: 'd1', timestamp: '2026-01-01T00:00:00.000Z', contentType, entry: { id: entryId } };
}

const ids = async () => (await getAllDocuments()).map((d) => d.id).sort();

describe('syncToSearchIndex — reconcile', () => {
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

  it('ENTRY_PUBLISHED upserts the PUBLISHED doc', async () => {
    const ctId = await createType('Article');
    const e = await createEntry(ctId, 'hello', [
      { status: CONTENT_STATUSES.PUBLISHED, title: 'Hello', body: 'world', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_PUBLISHED', { id: ctId, identifier: 'Article' }, e.id));
    expect(await ids()).toEqual([`${e.id}__PUBLISHED`]);
  });

  it('a two-slot entry indexes a PUBLISHED and a CHANGED doc', async () => {
    const ctId = await createType('Article');
    const e = await createEntry(ctId, 'two', [
      { status: CONTENT_STATUSES.PUBLISHED, title: 'Live', body: 'live', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
      { status: CONTENT_STATUSES.CHANGED, title: 'Edited', body: 'edited' },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_DRAFT_SYNC', { id: ctId, identifier: 'Article' }, e.id));
    expect(await ids()).toEqual([`${e.id}__CHANGED`, `${e.id}__PUBLISHED`].sort());
  });

  it('publishing a CHANGED draft prunes the CHANGED doc, leaving only PUBLISHED', async () => {
    const ctId = await createType('Article');
    const e = await createEntry(ctId, 'two', [
      { status: CONTENT_STATUSES.PUBLISHED, title: 'Live', body: 'live', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
      { status: CONTENT_STATUSES.CHANGED, title: 'Edited', body: 'edited' },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_DRAFT_SYNC', { id: ctId, identifier: 'Article' }, e.id));
    await prisma.contentEntryVersion.deleteMany({ where: { entryId: e.id } });
    await prisma.contentEntryVersion.create({
      data: { entryId: e.id, data: { title: 'Edited', body: 'edited' }, entryTitle: 'Edited', status: CONTENT_STATUSES.PUBLISHED, publishedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await syncToSearchIndex(deps, entryPayload('ENTRY_PUBLISHED', { id: ctId, identifier: 'Article' }, e.id));
    expect(await ids()).toEqual([`${e.id}__PUBLISHED`]);
  });

  it('ENTRY_DELETED removes every status doc for the entry', async () => {
    const ctId = await createType('Article');
    const fakeId = '11111111-1111-1111-1111-111111111111';
    await addTestDocuments([
      { id: `${fakeId}__PUBLISHED`, entryId: fakeId, status: CONTENT_STATUSES.PUBLISHED, isWorkingVersion: true, entryKey: 'g', contentType: 'Article', entryTitle: 'G', publishedAt: null, fields: {} },
      { id: `${fakeId}__CHANGED`, entryId: fakeId, status: CONTENT_STATUSES.CHANGED, isWorkingVersion: true, entryKey: 'g', contentType: 'Article', entryTitle: 'G', publishedAt: null, fields: {} },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_DELETED', { id: ctId, identifier: 'Article' }, fakeId));
    expect(await getAllDocuments()).toEqual([]);
  });

  it('unpublish (CHANGED→DRAFT) leaves only the DRAFT doc', async () => {
    const ctId = await createType('Article');
    const e = await createEntry(ctId, 'd', [
      { status: CONTENT_STATUSES.DRAFT, title: 'Back to draft', body: 'b' },
    ]);
    await addTestDocuments([
      { id: `${e.id}__PUBLISHED`, entryId: e.id, status: CONTENT_STATUSES.PUBLISHED, isWorkingVersion: false, entryKey: 'd', contentType: 'Article', entryTitle: 'Old', publishedAt: null, fields: {} },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_UNPUBLISHED', { id: ctId, identifier: 'Article' }, e.id));
    expect(await ids()).toEqual([`${e.id}__DRAFT`]);
  });

  it('archiving (entry present, only an ARCHIVED version) prunes all of its docs', async () => {
    const ctId = await createType('Article');
    const e = await createEntry(ctId, 'arch', [
      { status: CONTENT_STATUSES.ARCHIVED, title: 'Archived', body: 'a', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    // A stale PUBLISHED doc from before the archive — reconcile must remove it.
    await addTestDocuments([
      { id: `${e.id}__PUBLISHED`, entryId: e.id, status: CONTENT_STATUSES.PUBLISHED, isWorkingVersion: true, entryKey: 'arch', contentType: 'Article', entryTitle: 'Archived', publishedAt: null, fields: {} },
    ]);
    await syncToSearchIndex(deps, entryPayload('ENTRY_UNPUBLISHED', { id: ctId, identifier: 'Article' }, e.id));
    expect(await getAllDocuments()).toEqual([]);
  });

  it('CONTENT_TYPE_SCHEMA_CHANGED reindexes per-version docs for every indexable entry of the type', async () => {
    const ctId = await createType('Article');
    const a = await createEntry(ctId, 'a', [
      { status: CONTENT_STATUSES.PUBLISHED, title: 'A', body: 'aa', publishedAt: new Date('2026-01-01T00:00:00.000Z') },
      { status: CONTENT_STATUSES.CHANGED, title: 'A2', body: 'aaa' },
    ]);
    const b = await createEntry(ctId, 'b', [
      { status: CONTENT_STATUSES.DRAFT, title: 'B', body: 'bb' },
    ]);
    await syncToSearchIndex(deps, {
      event: 'CONTENT_TYPE_SCHEMA_CHANGED', deliveryId: 'd2', contentTypeId: ctId, contentTypeIdentifier: 'Article', occurredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await ids()).toEqual([`${a.id}__CHANGED`, `${a.id}__PUBLISHED`, `${b.id}__DRAFT`].sort());
  });

  it('ignores an unknown event (no-op)', async () => {
    await addTestDocuments([
      { id: 'keep__PUBLISHED', entryId: 'keep', status: CONTENT_STATUSES.PUBLISHED, isWorkingVersion: true, entryKey: 'keep', contentType: 'Other', entryTitle: 'K', publishedAt: null, fields: {} },
    ]);
    await syncToSearchIndex(deps, entryPayload('SOMETHING_ELSE', { id: 'x', identifier: 'Article' }, 'keep'));
    expect((await getAllDocuments()).map((d) => d.id)).toEqual(['keep__PUBLISHED']);
  });
});
