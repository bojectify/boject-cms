// apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts
//
// DB-backed unit test (follows import.test.ts pattern). Seeds two
// content types + a few entries, asserts the loader produces a
// snapshot the planner can consume.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { snapshotCurrentSchema } from './snapshotCurrentSchema';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const url = getTestDatabaseUrl();
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

describe('snapshotCurrentSchema', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('returns content types, fields, entry counts, and per-field usage', async () => {
    // Seed: Author with one entry; Article with two entries that
    // reference different Author entries via RELATION + a SELECT
    // category + a unique sku TEXT with one duplicate pair.
    const author = await prisma.contentType.create({
      data: {
        name: 'Author',
        identifier: 'Author',
        fields: {
          create: [
            {
              identifier: 'name',
              name: 'Name',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
            },
          ],
        },
      },
      include: { fields: true },
    });

    const authorEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: author.id,
        entryTitle: 'Dave',
        entryKey: 'dave',
        slug: 'dave',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'Dave',
              data: { name: 'Dave' },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    const article = await prisma.contentType.create({
      data: {
        name: 'Article',
        identifier: 'Article',
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
              identifier: 'category',
              name: 'Category',
              type: FIELD_TYPES.SELECT,
              required: false,
              unique: false,
              order: 1,
              options: { choices: ['news', 'opinion'] },
            },
            {
              identifier: 'author',
              name: 'Author',
              type: FIELD_TYPES.RELATION,
              required: false,
              unique: false,
              order: 2,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
            {
              identifier: 'sku',
              name: 'SKU',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: true,
              order: 3,
            },
          ],
        },
      },
    });

    await prisma.contentEntry.create({
      data: {
        contentTypeId: article.id,
        entryTitle: 'First',
        entryKey: 'first',
        slug: 'first',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'First',
              data: {
                title: 'First',
                category: 'news',
                author: { contentTypeId: author.id, entryId: authorEntry.id },
                sku: 'ABC',
              },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    await prisma.contentEntry.create({
      data: {
        contentTypeId: article.id,
        entryTitle: 'Second',
        entryKey: 'second',
        slug: 'second',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'Second',
              data: {
                title: 'Second',
                category: 'news',
                author: { contentTypeId: author.id, entryId: authorEntry.id },
                sku: 'ABC', // duplicate intentionally
              },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    const snapshot = await snapshotCurrentSchema(prisma);

    const articleSnap = snapshot.contentTypes.find(
      (c) => c.identifier === 'Article'
    )!;
    expect(articleSnap).toBeDefined();
    expect(articleSnap.entryCount).toBe(2);
    expect(articleSnap.fields).toHaveLength(4);

    const categoryUsage = snapshot.fieldUsage.get('Article:category')!;
    expect(categoryUsage.entriesWithValue).toBe(2);
    expect(categoryUsage.selectChoiceCounts!.get('news')).toBe(2);
    expect(categoryUsage.selectChoiceCounts!.get('opinion') ?? 0).toBe(0);

    const authorUsage = snapshot.fieldUsage.get('Article:author')!;
    expect(authorUsage.entriesWithValue).toBe(2);
    expect(authorUsage.relationTargetCounts!.get('Author')).toBe(2);

    const skuUsage = snapshot.fieldUsage.get('Article:sku')!;
    expect(skuUsage.entriesWithValue).toBe(2);
    expect(skuUsage.duplicateValues).toHaveLength(1);
    const skuDup = skuUsage.duplicateValues![0]!;
    expect(skuDup.value).toBe('ABC');
    expect(skuDup.entryIds).toHaveLength(2);

    const authorTypeSnap = snapshot.contentTypes.find(
      (c) => c.identifier === 'Author'
    )!;
    expect(authorTypeSnap.entryCount).toBe(1);
  });
});
