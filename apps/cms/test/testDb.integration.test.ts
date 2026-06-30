import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client';
import { createTestPrismaClient, resetTestDb } from './testDb';

// Proves the #406 per-file reset: after resetTestDb, boject_test is back at the
// seeded baseline regardless of what a file left behind. The afterAll wiring
// (vitest.integrationSetup.ts) runs this same function after every file; the
// full integration suite passing green confirms that wiring doesn't break the
// suite. This test is the direct unit proof of the reset itself.
describe('resetTestDb (#406)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    // Leave a clean slate (the global afterAll would too, but be explicit).
    await resetTestDb(prisma);
    await prisma.$disconnect();
  });

  it('truncates leaked content + webhooks and restores the admin/API-key baseline', async () => {
    // Leak the exact shape that breaks all-content's unscoped status=PUBLISHED
    // assertion: a CHANGED entry (a PUBLISHED version shadowed by a draft).
    const ct = await prisma.contentType.create({
      data: {
        name: 'Leak406',
        identifier: 'Leak406',
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
        entryTitle: 'Leaked',
        entryKey: 'leaked',
        versions: {
          create: [
            {
              data: { title: 'Leaked' },
              entryTitle: 'Leaked',
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
            {
              data: { title: 'Leaked edited' },
              entryTitle: 'Leaked edited',
              status: 'CHANGED',
            },
          ],
        },
      },
    });
    await prisma.webhook.create({
      data: {
        name: 'leak-406',
        kind: 'EXTERNAL',
        url: 'https://example.com/hook',
        secret: 'x',
        events: ['ENTRY_PUBLISHED'],
      },
    });
    // Mutate the auth baseline so we can prove it's restored, not just preserved.
    const adminBefore = await prisma.user.findFirstOrThrow();
    await prisma.user.update({
      where: { id: adminBefore.id },
      data: { passwordVersion: 7 },
    });

    await resetTestDb(prisma);

    // Content + webhooks gone.
    expect(await prisma.contentType.count()).toBe(0);
    expect(await prisma.contentTypeField.count()).toBe(0);
    expect(await prisma.contentEntry.count()).toBe(0);
    expect(await prisma.contentEntryVersion.count()).toBe(0);
    expect(await prisma.webhook.count()).toBe(0);
    expect(await prisma.webhookDelivery.count()).toBe(0);

    // Auth baseline restored: exactly one admin (passwordVersion reset) + the
    // un-revoked test API key.
    expect(await prisma.user.count()).toBe(1);
    const admin = await prisma.user.findFirstOrThrow();
    expect(admin.passwordVersion).toBe(0);
    expect(await prisma.apiKey.count()).toBe(1);
    const key = await prisma.apiKey.findFirstOrThrow();
    expect(key.revokedAt).toBeNull();
    expect(key.keyPrefix).toBe('boject_test');
  });
});
