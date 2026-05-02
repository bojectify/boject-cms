import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from './applySchema';
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
});
