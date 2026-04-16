import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

describe('exportBundle', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('exports schema-only bundle with UUIDs in non-portable mode', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
      include: { fields: true },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'schema',
      portable: false,
    });

    expect(bundle.version).toBe(2);
    expect(bundle.portable).toBe(false);
    expect(bundle.contentTypes).toHaveLength(1);
    expect(bundle.contentTypes![0]?.id).toBe(ct.id);
    expect(bundle.contentTypes![0]?.fields[0]?.id).toBe(ct.fields[0]?.id);
    expect(bundle.entries).toBeUndefined();
  });

  it('strips UUIDs in portable mode', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'schema',
      portable: true,
    });

    expect(bundle.portable).toBe(true);
    expect(bundle.contentTypes![0]?.id).toBeNull();
    expect(bundle.contentTypes![0]?.fields[0]?.id).toBeNull();
  });

  it('exports entries with all metadata in --all mode', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'Hello',
        slug: 'hello',
        versions: {
          create: {
            data: { title: 'Hello' },
            entryTitle: 'Hello',
            status: 'PUBLISHED',
            publishedAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, { mode: 'all', portable: false });

    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries![0]).toMatchObject({
      entryTitle: 'Hello',
      slug: 'hello',
    });
    expect(bundle.entries![0]?.versions).toHaveLength(1);
    expect(bundle.entries![0]?.versions![0]).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('rewrites relation refs to identifier+slug in portable mode', async () => {
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
        entryTitle: 'News',
        slug: 'news',
        versions: {
          create: {
            data: { name: 'News' },
            entryTitle: 'News',
            status: 'PUBLISHED',
          },
        },
      },
    });
    const blog = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
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
        contentTypeId: blog.id,
        entryTitle: 'Hello',
        slug: 'hello',
        versions: {
          create: {
            data: {
              title: 'Hello',
              category: {
                contentTypeId: category.id,
                entryId: categoryEntry.id,
              },
            },
            entryTitle: 'Hello',
            status: 'DRAFT',
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, { mode: 'all', portable: true });

    const blogEntry = bundle.entries!.find(
      (e) => e.contentTypeIdentifier === 'BlogPost'
    )!;
    expect(blogEntry.versions![0]!.data.category).toEqual({
      contentTypeIdentifier: 'Category',
      entryKey: 'news',
    });

    const blogType = bundle.contentTypes!.find(
      (c) => c.identifier === 'BlogPost'
    )!;
    const categoryField = blogType.fields.find(
      (f) => f.identifier === 'category'
    )!;
    expect(categoryField.options?.targetContentTypeIdentifiers).toEqual([
      'Category',
    ]);
  });
});
