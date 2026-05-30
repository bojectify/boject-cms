import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { importBundle } from './import';
import type { Bundle } from './types';
import { BUNDLE_VERSION } from './types';
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
  version: 2,
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
      version: 2,
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
          versions: [
            {
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: null,
              data: { name: 'News' },
            },
          ],
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          entryKey: 'hello',
          slug: 'hello',
          versions: [
            {
              status: CONTENT_STATUSES.DRAFT,
              publishedAt: null,
              data: {
                title: 'Hello',
                category: {
                  contentTypeIdentifier: 'Category',
                  entryKey: 'news',
                },
              },
            },
          ],
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
      version: 2,
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
      version: 2,
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
            versions: [
              {
                status: CONTENT_STATUSES.DRAFT,
                publishedAt: null,
                data: { title: 'Imported' },
              },
            ],
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
            versions: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                publishedAt: null,
                data: { name: 'News' },
              },
            ],
          },
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'Post',
            entryTitle: 'Hello',
            entryKey: 'hello',
            slug: 'hello-post',
            versions: [
              {
                status: CONTENT_STATUSES.DRAFT,
                publishedAt: null,
                data: {
                  title: 'Hello',
                  category: {
                    contentTypeIdentifier: 'Category',
                    entryKey: 'news',
                  },
                },
              },
            ],
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
            versions: [
              {
                status: CONTENT_STATUSES.DRAFT,
                publishedAt: null,
                data: { title: 'Foo' },
              },
            ],
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
            versions: [
              {
                status: CONTENT_STATUSES.DRAFT,
                publishedAt: null,
                data: { title: 'Foo II' },
              },
            ],
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

  describe('importBundle on-conflict skip', () => {
    it('leaves the existing entry untouched and reports skipped', async () => {
      const contentType = await prisma.contentType.create({
        data: {
          identifier: 'PageSkipTest',
          name: 'Page Skip Test',
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
            ],
          },
        },
      });
      const seeded = await prisma.contentEntry.create({
        data: {
          contentTypeId: contentType.id,
          entryTitle: 'Original Title',
          entryKey: 'original-title',
          slug: null,
          versions: {
            create: {
              data: { title: 'Original Title' },
              entryTitle: 'Original Title',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          },
        },
      });
      const seededUpdatedAt = seeded.updatedAt;

      const bundle: Bundle = {
        version: BUNDLE_VERSION,
        exportedAt: '2026-05-30T00:00:00.000Z',
        portable: false,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'PageSkipTest',
            entryTitle: 'Conflicting Title',
            entryKey: 'original-title',
            slug: null,
            versions: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                data: { title: 'Conflicting Title' },
                publishedAt: '2026-05-30T00:00:00.000Z',
              },
            ],
          },
        ],
      };

      const result = await importBundle(prisma, bundle, {
        mode: 'entries',
        onConflict: 'skip',
      });

      expect(result).toMatchObject({
        entriesCreated: 0,
        entriesUpdated: 0,
        entriesSkipped: 1,
      });

      const after = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: seeded.id },
      });
      expect(after.entryTitle).toBe('Original Title');
      expect(after.updatedAt.getTime()).toBe(seededUpdatedAt.getTime());
    });
  });

  describe('importBundle on-conflict replace', () => {
    it('wholesale-replaces versions, preserves id+entryKey+createdAt, updates envelope', async () => {
      const contentType = await prisma.contentType.create({
        data: {
          identifier: 'PageReplaceTest',
          name: 'Page Replace Test',
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
            ],
          },
        },
      });
      const seeded = await prisma.contentEntry.create({
        data: {
          contentTypeId: contentType.id,
          entryTitle: 'Original',
          entryKey: 'replace-target',
          slug: 'original-slug',
          versions: {
            create: [
              {
                data: { title: 'Original' },
                entryTitle: 'Original',
                status: CONTENT_STATUSES.PUBLISHED,
                publishedAt: new Date(),
              },
              {
                data: { title: 'Original Draft' },
                entryTitle: 'Original Draft',
                status: CONTENT_STATUSES.CHANGED,
                publishedAt: null,
              },
            ],
          },
        },
        include: { versions: true },
      });
      const seededCreatedAt = seeded.createdAt;
      const oldVersionIds = seeded.versions.map((v) => v.id);

      const bundle: Bundle = {
        version: BUNDLE_VERSION,
        exportedAt: '2026-05-30T00:00:00.000Z',
        portable: false,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'PageReplaceTest',
            entryTitle: 'Replaced',
            entryKey: 'replace-target',
            slug: 'replaced-slug',
            versions: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                data: { title: 'Replaced' },
                publishedAt: '2026-05-30T00:00:00.000Z',
              },
            ],
          },
        ],
      };

      const result = await importBundle(prisma, bundle, {
        mode: 'entries',
        onConflict: 'replace',
        author: 'olly@example.com',
      });

      expect(result).toMatchObject({
        entriesCreated: 0,
        entriesUpdated: 1,
        entriesSkipped: 0,
      });

      const after = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: seeded.id },
        include: { versions: true },
      });
      expect(after.id).toBe(seeded.id);
      expect(after.entryKey).toBe('replace-target');
      expect(after.createdAt.getTime()).toBe(seededCreatedAt.getTime());
      expect(after.entryTitle).toBe('Replaced');
      expect(after.slug).toBe('replaced-slug');

      expect(after.versions).toHaveLength(1);
      expect(after.versions[0]!.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(after.versions[0]!.data).toEqual({ title: 'Replaced' });
      expect(after.versions[0]!.createdBy).toBe('olly@example.com');
      expect(after.versions[0]!.updatedBy).toBe('olly@example.com');
      expect(oldVersionIds).not.toContain(after.versions[0]!.id);
    });
  });

  describe('importBundle on-conflict=replace with portable RELATION', () => {
    it('resolves relations to the updated entry id, not a new one', async () => {
      const author = await prisma.contentType.create({
        data: {
          identifier: 'AuthorReplaceTest',
          name: 'Author Replace Test',
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
      });
      const article = await prisma.contentType.create({
        data: {
          identifier: 'ArticleReplaceTest',
          name: 'Article Replace Test',
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
                identifier: 'author',
                name: 'Author',
                type: FIELD_TYPES.RELATION,
                required: false,
                order: 1,
                options: { targetContentTypeIds: [author.id] },
              },
            ],
          },
        },
      });
      const seededAuthor = await prisma.contentEntry.create({
        data: {
          contentTypeId: author.id,
          entryTitle: 'Olly',
          entryKey: 'olly',
          slug: 'olly',
          versions: {
            create: {
              data: { name: 'Olly' },
              entryTitle: 'Olly',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          },
        },
      });

      const bundle: Bundle = {
        version: BUNDLE_VERSION,
        exportedAt: '2026-05-30T00:00:00.000Z',
        portable: true,
        entries: [
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'AuthorReplaceTest',
            entryTitle: 'Olly (replaced)',
            entryKey: 'olly',
            slug: 'olly',
            versions: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                data: { name: 'Olly (replaced)' },
                publishedAt: '2026-05-30T00:00:00.000Z',
              },
            ],
          },
          {
            id: null,
            contentTypeId: null,
            contentTypeIdentifier: 'ArticleReplaceTest',
            entryTitle: 'My Article',
            entryKey: 'my-article',
            slug: 'my-article',
            versions: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                data: {
                  title: 'My Article',
                  author: {
                    contentTypeIdentifier: 'AuthorReplaceTest',
                    entryKey: 'olly',
                  },
                },
                publishedAt: '2026-05-30T00:00:00.000Z',
              },
            ],
          },
        ],
      };

      await importBundle(prisma, bundle, {
        mode: 'entries',
        onConflict: 'replace',
      });

      const articleEntry = await prisma.contentEntry.findFirstOrThrow({
        where: { contentTypeId: article.id, entryKey: 'my-article' },
        include: {
          versions: { where: { status: CONTENT_STATUSES.PUBLISHED } },
        },
      });
      const articleData = articleEntry.versions[0]!.data as Record<
        string,
        unknown
      >;
      const authorRef = articleData.author as {
        contentTypeId: string;
        entryId: string;
      };
      expect(authorRef.entryId).toBe(seededAuthor.id);
    });
  });
});
