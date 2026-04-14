import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { importBundle } from './import';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function seed() {
  const category = await prisma.contentType.create({
    data: {
      identifier: 'Category',
      name: 'Category',
      fields: {
        create: {
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
        },
      },
    },
  });
  const categoryEntry = await prisma.contentEntry.create({
    data: {
      contentTypeId: category.id,
      data: { name: 'News' },
      entryTitle: 'News',
      slug: 'news',
      status: 'PUBLISHED',
    },
  });
  const post = await prisma.contentType.create({
    data: {
      identifier: 'Post',
      name: 'Post',
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
          {
            identifier: 'category',
            name: 'Category',
            type: 'RELATION',
            required: false,
            order: 1,
            options: { targetContentTypeIds: [category.id] },
          },
        ],
      },
    },
  });
  await prisma.contentEntry.create({
    data: {
      contentTypeId: post.id,
      data: {
        title: 'Welcome',
        category: { contentTypeId: category.id, entryId: categoryEntry.id },
      },
      entryTitle: 'Welcome',
      slug: 'welcome',
      status: 'DRAFT',
    },
  });
}

describe('export → import round-trip', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('preserves schema and entries in portable mode', async () => {
    await seed();
    const bundle = await exportBundle(prisma, { mode: 'all', portable: true });

    await reset();

    const result = await importBundle(prisma, bundle, { mode: 'all' });
    expect(result.contentTypesCreated).toBe(2);
    expect(result.entriesCreated).toBe(2);

    const post = await prisma.contentType.findUnique({
      where: { identifier: 'Post' },
    });
    const category = await prisma.contentType.findUnique({
      where: { identifier: 'Category' },
    });
    const welcome = await prisma.contentEntry.findFirst({
      where: { contentTypeId: post!.id, slug: 'welcome' },
    });
    const news = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = welcome!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: news!.id,
    });
  });
});
