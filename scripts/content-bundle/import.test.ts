import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { importBundle } from './import';
import type { Bundle } from './types';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const schemaOnly: Bundle = {
  version: 1,
  exportedAt: '2026-04-14T10:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'BlogPost',
      name: 'Blog Post',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
        {
          id: null,
          identifier: 'body',
          name: 'Body',
          type: 'TEXTAREA',
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
};

describe('importBundle', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('imports a portable schema-only bundle with fresh UUIDs', async () => {
    const result = await importBundle(prisma, schemaOnly, { mode: 'schema' });
    expect(result.contentTypesCreated).toBe(1);
    expect(result.entriesCreated).toBe(0);

    const stored = await prisma.contentType.findMany({
      include: { fields: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.identifier).toBe('BlogPost');
    expect(stored[0]?.fields).toHaveLength(2);
  });

  it('fails when importing a bundle with an identifier that already exists', async () => {
    await importBundle(prisma, schemaOnly, { mode: 'schema' });
    await expect(
      importBundle(prisma, schemaOnly, { mode: 'schema' })
    ).rejects.toThrow(/BlogPost/);
  });

  it('imports entries with portable refs via two-pass resolution', async () => {
    const withRelations: Bundle = {
      version: 1,
      exportedAt: '2026-04-14T10:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Category',
          name: 'Category',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
        {
          id: null,
          identifier: 'BlogPost',
          name: 'Blog Post',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'category',
              name: 'Category',
              type: 'RELATION',
              required: false,
              order: 1,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['Category'],
              },
            },
          ],
        },
      ],
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Category',
          entryTitle: 'News',
          slug: 'news',
          status: 'PUBLISHED',
          publishedAt: null,
          data: { name: 'News' },
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          slug: 'hello',
          status: 'DRAFT',
          publishedAt: null,
          data: {
            title: 'Hello',
            category: { contentTypeIdentifier: 'Category', entryKey: 'news' },
          },
        },
      ],
    };

    const result = await importBundle(prisma, withRelations, { mode: 'all' });
    expect(result.entriesCreated).toBe(2);

    const blog = await prisma.contentType.findUnique({
      where: { identifier: 'BlogPost' },
    });
    const category = await prisma.contentType.findUnique({
      where: { identifier: 'Category' },
    });
    const blogPost = await prisma.contentEntry.findFirst({
      where: { contentTypeId: blog!.id, slug: 'hello' },
    });
    const newsCategory = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = blogPost!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: newsCategory!.id,
    });
  });

  it('rolls back on failure mid-import', async () => {
    const badBundle: Bundle = {
      ...schemaOnly,
      contentTypes: [
        schemaOnly.contentTypes![0]!,
        {
          // identifier collides with itself — two types with same identifier
          ...schemaOnly.contentTypes![0]!,
        },
      ],
    };
    await expect(
      importBundle(prisma, badBundle, { mode: 'schema' })
    ).rejects.toThrow();
    const count = await prisma.contentType.count();
    expect(count).toBe(0);
  });
});
