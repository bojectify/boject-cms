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
});
