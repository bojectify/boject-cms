import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { importBundle } from './import';
import type { Bundle } from './types';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import * as fx from './import.integration.fixtures';

const url = getTestDatabaseUrl();
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const schemaOnly = fx.schemaOnly;

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
    const result = await importBundle(prisma, fx.withRelations, {
      mode: 'all',
    });
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
    const result = await importBundle(prisma, fx.forwardRef, { mode: 'all' });
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
    await expect(
      importBundle(prisma, fx.danglingRef, { mode: 'schema' })
    ).rejects.toThrow(
      /RELATION field "ref" targets unknown content type "DoesNotExist"/
    );
  });

  describe('entryKey handling on import (#205)', () => {
    it('rejects a bundle whose entries lack entryKey', async () => {
      await expect(
        importBundle(prisma, fx.missingEntryKeyBundle as never, { mode: 'all' })
      ).rejects.toThrow(/entryKey/);
    });

    it('writes entryKey straight from the bundle to the DB', async () => {
      await importBundle(prisma, fx.writesEntryKeyBundle, { mode: 'all' });
      const entry = await prisma.contentEntry.findFirstOrThrow({
        where: { entryKey: 'imported-key' },
      });
      expect(entry.entryKey).toBe('imported-key');
    });

    it('resolves portable RELATION refs via entryKey', async () => {
      await importBundle(prisma, fx.portableRelByEntryKeyBundle, {
        mode: 'all',
      });

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
      await importBundle(prisma, fx.conflictKeyFirstBundle, { mode: 'all' });

      // Second import targets the existing type and reuses entryKey 'foo'.
      await expect(
        importBundle(prisma, fx.conflictKeySecondBundle, { mode: 'entries' })
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

      const result = await importBundle(prisma, fx.skipConflictBundle, {
        mode: 'entries',
        onConflict: 'skip',
      });

      expect(result).toEqual({
        contentTypesCreated: 0,
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

      const result = await importBundle(prisma, fx.replaceConflictBundle, {
        mode: 'entries',
        onConflict: 'replace',
        author: 'olly@example.com',
      });

      expect(result).toEqual({
        contentTypesCreated: 0,
        entriesCreated: 0,
        entriesUpdated: 1,
        entriesSkipped: 0,
      });

      const after = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: seeded.id },
        include: { versions: true },
      });
      expect(after.id).toBe(seeded.id);
      expect(after.contentTypeId).toBe(seeded.contentTypeId);
      expect(after.entryKey).toBe('replace-target');
      expect(after.createdAt.getTime()).toBe(seededCreatedAt.getTime());
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        seeded.updatedAt.getTime()
      );
      expect(after.entryTitle).toBe('Replaced');
      expect(after.slug).toBe('replaced-slug');

      expect(after.versions).toHaveLength(1);
      expect(after.versions[0]!.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(after.versions[0]!.data).toEqual({ title: 'Replaced' });
      expect(after.versions[0]!.createdBy).toBe('olly@example.com');
      expect(after.versions[0]!.updatedBy).toBe('olly@example.com');
      expect(oldVersionIds).not.toContain(after.versions[0]!.id);

      const orphanCount = await prisma.contentEntryVersion.count({
        where: { id: { in: oldVersionIds } },
      });
      expect(orphanCount).toBe(0);
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

      await importBundle(prisma, fx.replacePortableRelationBundle, {
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

  describe('importBundle dry-run', () => {
    it('reports planned counts without writing to the DB', async () => {
      const contentType = await prisma.contentType.create({
        data: {
          identifier: 'PageDryRunTest',
          name: 'Page Dry Run Test',
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
          entryKey: 'dry-run-target',
          slug: null,
          versions: {
            create: {
              data: { title: 'Original' },
              entryTitle: 'Original',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          },
        },
      });
      const seededUpdatedAt = seeded.updatedAt;
      const beforeCount = await prisma.contentEntry.count({
        where: { contentTypeId: contentType.id },
      });

      const result = await importBundle(prisma, fx.dryRunBundle, {
        mode: 'entries',
        onConflict: 'replace',
        dryRun: true,
      });

      expect(result).toEqual({
        contentTypesCreated: 0,
        entriesCreated: 1,
        entriesUpdated: 1,
        entriesSkipped: 0,
      });

      const afterCount = await prisma.contentEntry.count({
        where: { contentTypeId: contentType.id },
      });
      expect(afterCount).toBe(beforeCount);

      const afterVersionCount = await prisma.contentEntryVersion.count({
        where: { entry: { contentTypeId: contentType.id } },
      });
      // The seeded entry has exactly one PUBLISHED version; the new entry
      // in the bundle never got persisted (dry-run rollback).
      expect(afterVersionCount).toBe(1);

      const after = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: seeded.id },
      });
      expect(after.entryTitle).toBe('Original');
      expect(after.updatedAt.getTime()).toBe(seededUpdatedAt.getTime());
    });
  });

  describe('non-portable dangling reference guard', () => {
    // Build NON-PORTABLE bundles (portable: false) with a content type that has
    // an ENTRY_TITLE field and a self-targeting RELATION field "rel". Entries
    // carry real `id` UUIDs; `data.rel` is { contentTypeId: <typeId>, entryId }.

    it('throws and persists nothing when a RELATION points at a missing entry', async () => {
      const typeId = randomUUID();
      const entryId = randomUUID();
      const missingId = randomUUID();
      const danglingBundle = fx.danglingRelationBundle(
        typeId,
        entryId,
        missingId
      );

      const before = await prisma.contentEntry.count();
      await expect(
        importBundle(prisma, danglingBundle, { mode: 'all' })
      ).rejects.toThrow(/references missing entry/);
      expect(await prisma.contentEntry.count()).toBe(before); // rolled back
    });

    it('resolves a forward reference to another entry in the same bundle', async () => {
      const typeId = randomUUID();
      const idA = randomUUID();
      const idB = randomUUID();
      const forwardRefBundle = fx.forwardRefEntryBundle(typeId, idA, idB);

      await expect(
        importBundle(prisma, forwardRefBundle, { mode: 'all' })
      ).resolves.toBeDefined();
    });

    it('resolves a reference to a pre-existing target entry', async () => {
      const typeId = randomUUID();
      const existingId = randomUUID();

      // Seed the content type + target entry B first via a schema+entries import.
      await importBundle(prisma, fx.preExistingSeedBundle(typeId, existingId), {
        mode: 'all',
      });

      // Now import a new entry whose rel points at the pre-existing entry.
      const refToExistingBundle = fx.refToExistingBundle(
        typeId,
        randomUUID(),
        existingId
      );

      await expect(
        importBundle(prisma, refToExistingBundle, { mode: 'entries' })
      ).resolves.toBeDefined();
    });

    it('throws on a dangling RICHTEXT cmsEmbed reference', async () => {
      const typeId = randomUUID();
      const entryId = randomUUID();
      const missingId = randomUUID();
      const danglingRichtextBundle = fx.danglingRichtextBundle(
        typeId,
        entryId,
        missingId
      );

      await expect(
        importBundle(prisma, danglingRichtextBundle, { mode: 'all' })
      ).rejects.toThrow(/references missing entry/);
    });

    it('throws and persists nothing when a MULTIRELATION array contains a missing entry', async () => {
      // Build a NON-PORTABLE bundle whose content type has an ENTRY_TITLE plus a
      // self-targeting MULTIRELATION field "mrel". One entry's data.mrel is an
      // array mixing a VALID self-ref (its own id) with a ref to a missing id —
      // proving the guard walks MULTIRELATION arrays and that one-resolves /
      // one-dangles still throws.
      const typeId = randomUUID();
      const entryId = randomUUID();
      const missingId = randomUUID();
      const danglingMrelBundle = fx.danglingMultirelationBundle(
        typeId,
        entryId,
        missingId
      );

      const before = await prisma.contentEntry.count();
      await expect(
        importBundle(prisma, danglingMrelBundle, { mode: 'all' })
      ).rejects.toThrow(/references missing entry/);
      expect(await prisma.contentEntry.count()).toBe(before); // rolled back
    });

    it('does NOT re-validate a pre-existing dangling entry that on-conflict=skip leaves untouched', async () => {
      // Intent pin: skipped entries bypass the guard. The guard only validates
      // entries THIS import creates/updates (i.e. entries that enter
      // pendingEntries). An on-conflict=skip collision leaves the existing row
      // alone, so we never re-write it and never re-check its references —
      // re-validating pre-existing rows is deliberately out of scope. We seed a
      // row whose data.rel already dangles (bypassing importBundle's guard via
      // raw Prisma), then import a colliding entry with onConflict: 'skip' and
      // assert the import resolves rather than throwing on the stale dangle.
      const missingId = randomUUID();

      const ct = await prisma.contentType.create({
        data: {
          identifier: 'SkipDangleType',
          name: 'SkipDangleType',
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
                identifier: 'rel',
                name: 'Rel',
                type: FIELD_TYPES.RELATION,
                required: false,
                order: 1,
                options: { targetContentTypeIds: [] }, // patched below to self
              },
            ],
          },
        },
      });

      // Point the RELATION field at its own content type (self-targeting).
      await prisma.contentTypeField.updateMany({
        where: { contentTypeId: ct.id, identifier: 'rel' },
        data: { options: { targetContentTypeIds: [ct.id] } },
      });

      // Seed an entry whose data.rel points at a NON-EXISTENT entry — this is an
      // already-dangling row, written raw so importBundle's guard never sees it.
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'Dup',
          entryKey: 'dup',
          slug: 'dup',
          versions: {
            create: {
              data: {
                title: 'Dup',
                rel: { contentTypeId: ct.id, entryId: missingId },
              },
              entryTitle: 'Dup',
              status: CONTENT_STATUSES.PUBLISHED,
            },
          },
        },
      });

      // Import a non-portable bundle (schema already present) carrying an entry
      // with the SAME identifier + entryKey 'dup' so it collides, using skip.
      const collidingBundle = fx.skipDangleCollidingBundle(ct.id, randomUUID());

      const result = await importBundle(prisma, collidingBundle, {
        mode: 'entries',
        onConflict: 'skip',
      });

      // The colliding entry is skipped, so its (and the pre-existing row's)
      // dangling ref is never re-checked — the import resolves cleanly.
      expect(result.entriesSkipped).toBeGreaterThanOrEqual(1);
    });
  });
});
