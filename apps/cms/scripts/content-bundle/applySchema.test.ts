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
});
