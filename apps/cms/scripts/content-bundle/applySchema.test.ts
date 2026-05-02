import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from './applySchema';
import * as snapshotModule from './snapshotCurrentSchema';
import * as schemaModule from '../../server/graphql/schema';
import type { Bundle } from './types';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const emptyBundle: Bundle = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
};

describe('applySchema', () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  describe('happy path — no-op', () => {
    it('returns changed=false for an empty bundle on an empty DB', async () => {
      const result = await applySchema(prisma, emptyBundle);
      expect(result.changed).toBe(false);
      expect(result.applied).toEqual({
        contentTypesCreated: 0,
        contentTypesUpdated: 0,
        contentTypesRemoved: 0,
        fieldsCreated: 0,
        fieldsUpdated: 0,
        fieldsRemoved: 0,
      });
      expect(result.plan.contentTypes.create).toEqual([]);
      expect(result.plan.blockers).toEqual([]);
    });
  });

  describe('validateBundle integration', () => {
    it('throws SchemaApplyValidationError on a malformed bundle, no transaction opened', async () => {
      const malformedBundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            // No fields array → validateBundle rejects "fields must be an array"
          },
        ],
      } as unknown as Bundle;

      await expect(applySchema(prisma, malformedBundle)).rejects.toThrow(
        /Bundle validation failed/
      );
      await expect(applySchema(prisma, malformedBundle)).rejects.toMatchObject({
        code: 'BUNDLE_INVALID',
      });
    });
  });

  describe('blocker handling — refuses before mutating', () => {
    it('throws SchemaApplyBlockedError on a blocker, DB unchanged', async () => {
      // Seed a content type with an entry. An empty bundle would try to
      // remove it, which is blocked even with allowDestructive.
      const ct = await prisma.contentType.create({
        data: {
          identifier: 'Locked',
          name: 'Locked',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'X',
          slug: 'x',
          versions: {
            create: {
              data: { title: 'X' },
              entryTitle: 'X',
              status: 'PUBLISHED',
            },
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };

      await expect(
        applySchema(prisma, bundle, { allowDestructive: true })
      ).rejects.toMatchObject({
        code: 'SCHEMA_APPLY_BLOCKED',
      });

      // DB unchanged — content type still exists.
      const stillThere = await prisma.contentType.findUnique({
        where: { identifier: 'Locked' },
      });
      expect(stillThere).not.toBeNull();
    });

    it('blocker error carries the blockers array and the plan', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'WithEntries',
          name: 'WithEntries',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });
      await prisma.contentEntry.create({
        data: {
          contentTypeId: (
            await prisma.contentType.findUniqueOrThrow({
              where: { identifier: 'WithEntries' },
            })
          ).id,
          entryTitle: 'X',
          slug: 'x',
          versions: {
            create: {
              data: { title: 'X' },
              entryTitle: 'X',
              status: 'PUBLISHED',
            },
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };

      try {
        await applySchema(prisma, bundle);
        throw new Error('expected applySchema to throw');
      } catch (e) {
        const err = e as { code: string; blockers: unknown[]; plan: unknown };
        expect(err.code).toBe('SCHEMA_APPLY_BLOCKED');
        expect(err.blockers.length).toBeGreaterThan(0);
        expect(err.plan).toBeDefined();
      }
    });
  });

  describe('happy path — pass 1 (types)', () => {
    it('creates a new content type from an empty DB, with its fields embedded', async () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: 'Blog article',
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
                identifier: 'slug',
                name: 'Slug',
                type: 'SLUG',
                required: false,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesCreated).toBe(1);

      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
        include: { fields: true },
      });
      expect(ct).not.toBeNull();
      expect(ct!.name).toBe('Article');
      expect(ct!.description).toBe('Blog article');
      expect(ct!.fields).toHaveLength(2);
      expect(ct!.fields.find((f) => f.identifier === 'title')!.unique).toBe(
        true
      );
      expect(ct!.fields.find((f) => f.identifier === 'slug')!.unique).toBe(
        true
      );
    });

    it('updates a content type display name (identifier unchanged)', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Old Name',
          description: null,
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'New Name',
            description: 'Renamed',
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
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesUpdated).toBe(1);

      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
      });
      expect(ct!.name).toBe('New Name');
      expect(ct!.description).toBe('Renamed');
    });
  });

  describe('happy path — pass 1 removes', () => {
    it('removes an empty content type with allowDestructive', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Stale',
          name: 'Stale',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };
      const result = await applySchema(prisma, bundle, {
        allowDestructive: true,
      });
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesRemoved).toBe(1);

      const gone = await prisma.contentType.findUnique({
        where: { identifier: 'Stale' },
      });
      expect(gone).toBeNull();
    });
  });

  describe('happy path — pass 2 (field creates)', () => {
    it('adds a field to an existing content type', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsCreated).toBe(1);

      const tagline = await prisma.contentTypeField.findFirst({
        where: { identifier: 'tagline' },
      });
      expect(tagline).not.toBeNull();
      expect(tagline!.type).toBe('TEXT');
    });
  });

  describe('happy path — pass 2 (field updates)', () => {
    it('updates a field name and order', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Old Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 5,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
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
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'title' },
      });
      expect(f!.name).toBe('Title');
      expect(f!.order).toBe(0);
    });

    it('updates a SELECT field options when a choice is added', async () => {
      await prisma.contentType.create({
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
                unique: true,
                order: 0,
              },
              {
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                unique: false,
                order: 1,
                options: { choices: ['news'] },
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
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
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                order: 1,
                options: { choices: ['news', 'opinion'] },
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'category' },
      });
      expect((f!.options as { choices: string[] }).choices).toEqual([
        'news',
        'opinion',
      ]);
    });

    it('updates required false → true when no entries have null', async () => {
      const ct = await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
              {
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 1,
              },
            ],
          },
        },
      });
      // Seed an entry whose tagline is set, so required: true is safe.
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'A',
          slug: 'a',
          versions: {
            create: {
              data: { title: 'A', tagline: 'Hello' },
              entryTitle: 'A',
              status: 'PUBLISHED',
            },
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: true,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'tagline' },
      });
      expect(f!.required).toBe(true);
    });
  });

  describe('happy path — pass 2 (field removes)', () => {
    it('removes a field with allowDestructive', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
              {
                identifier: 'oldField',
                name: 'Old',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 1,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
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
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle, {
        allowDestructive: true,
      });
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsRemoved).toBe(1);

      const gone = await prisma.contentTypeField.findFirst({
        where: { identifier: 'oldField' },
      });
      expect(gone).toBeNull();
    });
  });

  describe('two-pass ordering', () => {
    it('creates a content type and a RELATION field targeting it in one apply', async () => {
      // Article exists; Author is brand new; Article gets a RELATION field
      // targeting Author, all in one bundle.
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Author',
            name: 'Author',
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
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 1,
                options: { targetContentTypeIdentifiers: ['Author'] },
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesCreated).toBe(1);
      expect(result.applied.fieldsCreated).toBe(1);

      const authorField = await prisma.contentTypeField.findFirst({
        where: { identifier: 'author' },
      });
      expect(authorField).not.toBeNull();
      const opts = authorField!.options as {
        targetContentTypeIds?: string[];
        targetContentTypeIdentifiers?: string[];
      };
      // DB stores UUIDs, not identifiers — runtime (GraphQL, validation)
      // reads targetContentTypeIds. Identifiers belong only in bundles.
      expect(opts.targetContentTypeIdentifiers).toBeUndefined();
      expect(opts.targetContentTypeIds).toHaveLength(1);
      const authorType = await prisma.contentType.findUniqueOrThrow({
        where: { identifier: 'Author' },
      });
      expect(opts.targetContentTypeIds).toEqual([authorType.id]);
    });

    it('creates two content types that mutually relate in one apply', async () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Author',
            name: 'Author',
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
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 1,
                options: { targetContentTypeIdentifiers: ['Author'] },
              },
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.applied.contentTypesCreated).toBe(2);
      // Both types created with their fields embedded (no separate
      // pass 2 entries — both rode along with pass 1).
      expect(result.applied.fieldsCreated).toBe(0);
    });

    it('is a no-op when the DB was seeded by importBundle and apply-schema runs against the same portable bundle', async () => {
      // Mirrors the smoke-test scenario: import-starter writes the
      // bundle (resolves identifiers → UUIDs), then apply-schema runs
      // against the same bundle. The second pass must not re-update
      // RELATION fields just because the DB stores UUIDs and the
      // bundle has identifiers.
      const { importBundle } = await import('./import');
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Author',
            name: 'Author',
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
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 1,
                options: {
                  targetContentTypeIds: [null],
                  targetContentTypeIdentifiers: ['Author'],
                },
              },
            ],
          },
        ],
      };

      await importBundle(prisma, bundle, { mode: 'all', author: 'system' });

      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(false);
      expect(result.applied.fieldsUpdated).toBe(0);
    });

    it('is a no-op on second apply of the same portable bundle (RELATION targets resolve identically)', async () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Tag',
            name: 'Tag',
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
            identifier: 'Article',
            name: 'Article',
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
                identifier: 'tags',
                name: 'Tags',
                type: 'MULTIRELATION',
                required: false,
                order: 1,
                options: {
                  targetContentTypeIds: [null],
                  targetContentTypeIdentifiers: ['Tag'],
                },
              },
            ],
          },
        ],
      };

      const first = await applySchema(prisma, bundle);
      expect(first.changed).toBe(true);

      const second = await applySchema(prisma, bundle);
      expect(second.changed).toBe(false);
      expect(second.applied.fieldsUpdated).toBe(0);
    });
  });

  describe('concurrency — re-plan equality check', () => {
    it('throws SchemaChangedDuringApplyError when the snapshot changes between reads', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
              },
            ],
          },
        },
      });

      let callCount = 0;
      const realSnapshot = snapshotModule.snapshotCurrentSchema;
      const spy = vi.spyOn(snapshotModule, 'snapshotCurrentSchema');
      spy.mockImplementation(async (tx) => {
        callCount += 1;
        // Real snapshot for both calls — but inject a synthetic content
        // type into the second call's result so plansEqual returns false.
        const real = await realSnapshot(tx);
        if (callCount >= 2) {
          return {
            ...real,
            contentTypes: [
              ...real.contentTypes,
              {
                id: 'synthetic-id',
                identifier: 'InjectedType',
                name: 'Injected',
                description: null,
                fields: [],
                entryCount: 0,
              },
            ],
          };
        }
        return real;
      });

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Renamed',
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
            ],
          },
        ],
      };
      await expect(
        applySchema(prisma, bundle, { allowDestructive: true })
      ).rejects.toMatchObject({ code: 'SCHEMA_CHANGED_DURING_APPLY' });

      spy.mockRestore();

      // DB unchanged — name should still be Article (the rename rolled back).
      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
      });
      expect(ct!.name).toBe('Article');
    });
  });

  describe('invalidateSchema integration', () => {
    it('does NOT call invalidateSchema on a no-op apply', async () => {
      const spy = vi.spyOn(schemaModule, 'invalidateSchema');
      spy.mockImplementation(() => {});

      const result = await applySchema(prisma, emptyBundle);
      expect(result.changed).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls invalidateSchema once on a non-empty apply', async () => {
      const spy = vi.spyOn(schemaModule, 'invalidateSchema');
      spy.mockImplementation(() => {});

      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'NewType',
            name: 'NewType',
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
            ],
          },
        ],
      };
      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
