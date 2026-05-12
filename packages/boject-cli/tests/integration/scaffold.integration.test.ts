import { afterAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../apps/cms/generated/prisma/client.js';
import { PERF_TEST_DATABASE_URL } from './globalSetup.js';

const adapter = new PrismaPg({ connectionString: PERF_TEST_DATABASE_URL });
const prisma = new PrismaClient({ adapter });

afterAll(async () => {
  await prisma.$disconnect();
});

describe('integration scaffold', () => {
  it('boject_perf_test has been migrated and PerfArticle is seeded', async () => {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'PerfArticle' },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
    expect(ct).not.toBeNull();
    expect(ct!.name).toBe('Perf Article');
    expect(ct!.fields.map((f) => f.identifier)).toEqual([
      'entryTitle',
      'slug',
      'body',
      'publishDate',
    ]);
    expect(ct!.fields.map((f) => f.type)).toEqual([
      'ENTRY_TITLE',
      'SLUG',
      'TEXT',
      'DATETIME',
    ]);
  });
});
