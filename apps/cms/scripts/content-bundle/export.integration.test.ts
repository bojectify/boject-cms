import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const url = getTestDatabaseUrl();
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
            type: FIELD_TYPES.ENTRY_TITLE,
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
            type: FIELD_TYPES.ENTRY_TITLE,
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
            type: FIELD_TYPES.ENTRY_TITLE,
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
        entryKey: 'hello-entry',
        slug: 'hello',
        versions: {
          create: {
            data: { title: 'Hello' },
            entryTitle: 'Hello',
            status: CONTENT_STATUSES.PUBLISHED,
            publishedAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, { mode: 'all', portable: false });

    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries![0]).toMatchObject({
      entryTitle: 'Hello',
      entryKey: 'hello-entry',
      slug: 'hello',
    });
    expect(bundle.entries![0]?.versions).toHaveLength(1);
    expect(bundle.entries![0]?.versions![0]).toMatchObject({
      status: CONTENT_STATUSES.PUBLISHED,
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
            type: FIELD_TYPES.ENTRY_TITLE,
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
        entryKey: 'news',
        slug: 'news',
        versions: {
          create: {
            data: { name: 'News' },
            entryTitle: 'News',
            status: CONTENT_STATUSES.PUBLISHED,
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
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
            },
            {
              identifier: 'category',
              name: 'Category',
              type: FIELD_TYPES.RELATION,
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
        entryKey: 'hello',
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
            status: CONTENT_STATUSES.DRAFT,
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

describe('exportBundle filter options', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('publishedOnly drops draft versions and entries with no published version', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        },
      },
    });

    // Entry with both a PUBLISHED and a DRAFT (CHANGED) version.
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'Published',
        entryKey: 'published',
        slug: 'published',
        versions: {
          create: [
            {
              data: { title: 'Published' },
              entryTitle: 'Published',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date('2026-04-01T00:00:00.000Z'),
            },
            {
              data: { title: 'Published (edited)' },
              entryTitle: 'Published (edited)',
              status: CONTENT_STATUSES.CHANGED,
            },
          ],
        },
      },
    });

    // Draft-only entry.
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'DraftOnly',
        entryKey: 'draft-only',
        slug: 'draft-only',
        versions: {
          create: {
            data: { title: 'DraftOnly' },
            entryTitle: 'DraftOnly',
            status: CONTENT_STATUSES.DRAFT,
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'entries',
      portable: false,
      publishedOnly: true,
    });

    const entries = bundle.entries ?? [];
    // DRAFT-only entry is excluded entirely.
    expect(entries.every((e) => e.versions.length > 0)).toBe(true);
    // Every surviving version is PUBLISHED.
    expect(
      entries.flatMap((e) => e.versions).every((v) => v.status === 'PUBLISHED')
    ).toBe(true);
    // Sanity: the published entry survived; the draft-only one did not.
    expect(entries.map((e) => e.entryKey)).toEqual(['published']);
  });

  it('contentType filter restricts entries to the named identifier', async () => {
    const alpha = await prisma.contentType.create({
      data: {
        identifier: 'Alpha',
        name: 'Alpha',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        },
      },
    });
    const beta = await prisma.contentType.create({
      data: {
        identifier: 'Beta',
        name: 'Beta',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: alpha.id,
        entryTitle: 'A1',
        entryKey: 'a1',
        slug: 'a1',
        versions: {
          create: {
            data: { title: 'A1' },
            entryTitle: 'A1',
            status: CONTENT_STATUSES.PUBLISHED,
          },
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: beta.id,
        entryTitle: 'B1',
        entryKey: 'b1',
        slug: 'b1',
        versions: {
          create: {
            data: { title: 'B1' },
            entryTitle: 'B1',
            status: CONTENT_STATUSES.PUBLISHED,
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'entries',
      portable: false,
      contentType: 'Alpha',
    });

    expect(bundle.entries ?? []).toHaveLength(1);
    expect(
      (bundle.entries ?? []).every((e) => e.contentTypeIdentifier === 'Alpha')
    ).toBe(true);
  });

  it('publishedOnly + portable strips UUIDs, keeps PUBLISHED, and encodes relation refs', async () => {
    const category = await prisma.contentType.create({
      data: {
        identifier: 'Category',
        name: 'Category',
        fields: {
          create: {
            identifier: 'name',
            name: 'Name',
            type: FIELD_TYPES.ENTRY_TITLE,
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
        entryKey: 'news',
        slug: 'news',
        versions: {
          create: {
            data: { name: 'News' },
            entryTitle: 'News',
            status: CONTENT_STATUSES.PUBLISHED,
            publishedAt: new Date('2026-04-01T00:00:00.000Z'),
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
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
            },
            {
              identifier: 'category',
              name: 'Category',
              type: FIELD_TYPES.RELATION,
              required: false,
              order: 1,
              options: { targetContentTypeIds: [category.id] },
            },
          ],
        },
      },
    });
    // Entry with a PUBLISHED version (carrying the relation) plus a CHANGED draft.
    await prisma.contentEntry.create({
      data: {
        contentTypeId: blog.id,
        entryTitle: 'Hello',
        entryKey: 'hello',
        slug: 'hello',
        versions: {
          create: [
            {
              data: {
                title: 'Hello',
                category: {
                  contentTypeId: category.id,
                  entryId: categoryEntry.id,
                },
              },
              entryTitle: 'Hello',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date('2026-04-02T00:00:00.000Z'),
            },
            {
              data: {
                title: 'Hello (edited)',
                category: {
                  contentTypeId: category.id,
                  entryId: categoryEntry.id,
                },
              },
              entryTitle: 'Hello (edited)',
              status: CONTENT_STATUSES.CHANGED,
            },
          ],
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'entries',
      portable: true,
      publishedOnly: true,
    });

    const entries = bundle.entries ?? [];
    // Portable mode strips UUIDs off every surviving entry.
    expect(entries.every((e) => e.id === null)).toBe(true);
    expect(entries.every((e) => e.contentTypeId === null)).toBe(true);
    // Only PUBLISHED versions survive.
    expect(
      entries.flatMap((e) => e.versions).every((v) => v.status === 'PUBLISHED')
    ).toBe(true);

    // The relation ref on the surviving PUBLISHED version was encoded to the
    // portable identifier+entryKey shape rather than raw UUIDs — and resolved
    // correctly even though the unrelated draft version was filtered out.
    const blogEntry = entries.find(
      (e) => e.contentTypeIdentifier === 'BlogPost'
    )!;
    expect(blogEntry.versions).toHaveLength(1);
    expect(blogEntry.versions[0]!.data.category).toEqual({
      contentTypeIdentifier: 'Category',
      entryKey: 'news',
    });
  });

  it('unknown contentType identifier yields zero entries (no throw)', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Alpha',
        name: 'Alpha',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'entries',
      portable: false,
      contentType: 'DoesNotExist',
    });

    expect(bundle.entries ?? []).toHaveLength(0);
  });
});
