import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { importBundle } from './import';
import type { Bundle } from './types';
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
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
          order: 0,
          options: null,
        },
        {
          id: null,
          identifier: 'body',
          name: 'Body',
          type: FIELD_TYPES.TEXTAREA,
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
              type: FIELD_TYPES.ENTRY_TITLE,
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
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'category',
              name: 'Category',
              type: FIELD_TYPES.RELATION,
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
          entryKey: 'news',
          slug: 'news',
          status: CONTENT_STATUSES.PUBLISHED,
          publishedAt: null,
          data: { name: 'News' },
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          entryKey: 'hello',
          slug: 'hello',
          status: CONTENT_STATUSES.DRAFT,
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
      include: { versions: true },
    });
    const newsCategory = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = blogPost!.versions[0]!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: newsCategory!.id,
    });
  });

  it('resolves RELATION field targets that forward-reference later content types', async () => {
    const forwardRef: Bundle = {
      version: 1,
      exportedAt: '2026-04-14T10:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'TypeA',
          name: 'Type A',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'bs',
              name: 'Bs',
              type: FIELD_TYPES.MULTIRELATION,
              required: false,
              order: 1,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['TypeB'],
              },
            },
          ],
        },
        {
          id: null,
          identifier: 'TypeB',
          name: 'Type B',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };

    const result = await importBundle(prisma, forwardRef, { mode: 'all' });
    expect(result.contentTypesCreated).toBe(2);

    const typeA = await prisma.contentType.findUnique({
      where: { identifier: 'TypeA' },
      include: { fields: true },
    });
    const typeB = await prisma.contentType.findUnique({
      where: { identifier: 'TypeB' },
    });
    expect(typeA).not.toBeNull();
    expect(typeB).not.toBeNull();

    const bsField = typeA!.fields.find((f) => f.identifier === 'bs');
    expect(bsField).toBeDefined();
    const opts = bsField!.options as Record<string, unknown> | null;
    expect(opts).not.toBeNull();
    expect(opts!.targetContentTypeIds).toEqual([typeB!.id]);
    expect(opts!.targetContentTypeIdentifiers).toBeUndefined();
  });

  it('throws a clear error when a RELATION field targets an undeclared content type', async () => {
    const danglingRef: Bundle = {
      version: 1,
      exportedAt: '2026-04-14T10:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Orphan',
          name: 'Orphan',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'ref',
              name: 'Ref',
              type: FIELD_TYPES.RELATION,
              required: false,
              order: 1,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['DoesNotExist'],
              },
            },
          ],
        },
      ],
    };

    await expect(
      importBundle(prisma, danglingRef, { mode: 'schema' })
    ).rejects.toThrow(
      /RELATION field "ref" targets unknown content type "DoesNotExist"/
    );
  });

  describe('entryKey handling on import (#205)', () => {
    const baseTypeBundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-13T10:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'KeyedType',
          name: 'KeyedType',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };

    it('rejects a bundle whose entries lack entryKey', async () => {
      const bundle = {
        ...baseTypeBundle,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'KeyedType',
            entryTitle: 'Imported',
            // entryKey intentionally missing
            slug: 'imported',
            status: CONTENT_STATUSES.DRAFT,
            publishedAt: null,
            data: { title: 'Imported' },
          },
        ],
      };
      await expect(
        importBundle(prisma, bundle as never, { mode: 'all' })
      ).rejects.toThrow(/entryKey/);
    });

    it('writes entryKey straight from the bundle to the DB', async () => {
      const bundle: Bundle = {
        ...baseTypeBundle,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'KeyedType',
            entryTitle: 'Imported',
            entryKey: 'imported-key',
            slug: 'imported',
            status: CONTENT_STATUSES.DRAFT,
            publishedAt: null,
            data: { title: 'Imported' },
          },
        ],
      };
      await importBundle(prisma, bundle, { mode: 'all' });
      const entry = await prisma.contentEntry.findFirstOrThrow({
        where: { entryKey: 'imported-key' },
      });
      expect(entry.entryKey).toBe('imported-key');
    });

    it('resolves portable RELATION refs via entryKey', async () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-13T10:00:00.000Z',
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
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
          {
            id: null,
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: FIELD_TYPES.RELATION,
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
            entryKey: 'news',
            slug: 'news-cat',
            status: CONTENT_STATUSES.PUBLISHED,
            publishedAt: null,
            data: { name: 'News' },
          },
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'Post',
            entryTitle: 'Hello',
            entryKey: 'hello',
            slug: 'hello-post',
            status: CONTENT_STATUSES.DRAFT,
            publishedAt: null,
            data: {
              title: 'Hello',
              category: { contentTypeIdentifier: 'Category', entryKey: 'news' },
            },
          },
        ],
      };

      await importBundle(prisma, bundle, { mode: 'all' });

      const category = await prisma.contentType.findUniqueOrThrow({
        where: { identifier: 'Category' },
      });
      const newsEntry = await prisma.contentEntry.findFirstOrThrow({
        where: { contentTypeId: category.id, entryKey: 'news' },
      });
      const post = await prisma.contentType.findUniqueOrThrow({
        where: { identifier: 'Post' },
      });
      const helloEntry = await prisma.contentEntry.findFirstOrThrow({
        where: { contentTypeId: post.id, entryKey: 'hello' },
        include: { versions: true },
      });
      const data = helloEntry.versions[0]!.data as Record<string, unknown>;
      expect(data.category).toEqual({
        contentTypeId: category.id,
        entryId: newsEntry.id,
      });
    });

    it('rejects bundle with conflicting entryKey on target', async () => {
      // First import creates a KeyedType + an entry with entryKey 'foo'.
      const first: Bundle = {
        ...baseTypeBundle,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'KeyedType',
            entryTitle: 'Foo',
            entryKey: 'foo',
            slug: 'foo',
            status: CONTENT_STATUSES.DRAFT,
            publishedAt: null,
            data: { title: 'Foo' },
          },
        ],
      };
      await importBundle(prisma, first, { mode: 'all' });

      // Second import targets the existing type and reuses entryKey 'foo'.
      const second: Bundle = {
        version: 2,
        exportedAt: '2026-05-13T10:00:00.000Z',
        portable: true,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'KeyedType',
            entryTitle: 'Foo II',
            entryKey: 'foo',
            slug: 'foo-2',
            status: CONTENT_STATUSES.DRAFT,
            publishedAt: null,
            data: { title: 'Foo II' },
          },
        ],
      };
      await expect(
        importBundle(prisma, second, { mode: 'entries' })
      ).rejects.toThrow(/KeyedType:foo.*already exists/);
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
