import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  ensureCacheInvalidationWebhook,
  CACHE_INVALIDATION_WEBHOOK_NAME,
  CACHE_INVALIDATION_EVENTS,
} from './ensureCacheInvalidationWebhook';
import { getTestDatabaseUrl } from '../../test/dbUrl';

const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

async function clean() {
  await prisma.webhook.deleteMany();
}

describe('ensureCacheInvalidationWebhook', () => {
  beforeEach(clean);
  afterEach(clean);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates one INTERNAL cache webhook with the 4 events, null url/secret, no ENTRY_DRAFT_SYNC', async () => {
    await ensureCacheInvalidationWebhook(prisma);
    const rows = await prisma.webhook.findMany();
    expect(rows).toHaveLength(1);
    const w = rows[0]!;
    expect(w.kind).toBe('INTERNAL');
    expect(w.name).toBe(CACHE_INVALIDATION_WEBHOOK_NAME);
    expect(w.url).toBeNull();
    expect(w.secret).toBeNull();
    expect(w.enabled).toBe(true);
    expect([...w.events].sort()).toEqual([...CACHE_INVALIDATION_EVENTS].sort());
    expect(w.contentTypeIds).toEqual([]);
    expect(w.events).not.toContain('ENTRY_DRAFT_SYNC');
  });

  it('is idempotent — a second call leaves exactly one INTERNAL cache row', async () => {
    await ensureCacheInvalidationWebhook(prisma);
    await ensureCacheInvalidationWebhook(prisma);
    expect(
      await prisma.webhook.count({
        where: { kind: 'INTERNAL', name: CACHE_INVALIDATION_WEBHOOK_NAME },
      })
    ).toBe(1);
  });

  it('does not re-enable a row an operator disabled', async () => {
    await ensureCacheInvalidationWebhook(prisma);
    const before = await prisma.webhook.findFirstOrThrow({
      where: { kind: 'INTERNAL', name: CACHE_INVALIDATION_WEBHOOK_NAME },
    });
    await prisma.webhook.update({
      where: { id: before.id },
      data: { enabled: false },
    });
    await ensureCacheInvalidationWebhook(prisma);
    const after = await prisma.webhook.findFirstOrThrow({
      where: { kind: 'INTERNAL', name: CACHE_INVALIDATION_WEBHOOK_NAME },
    });
    expect(after.enabled).toBe(false);
  });
});
