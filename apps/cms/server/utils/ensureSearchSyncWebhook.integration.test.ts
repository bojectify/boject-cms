import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  ensureSearchSyncWebhook,
  SEARCH_SYNC_WEBHOOK_NAME,
  SEARCH_SYNC_EVENTS,
} from './ensureSearchSyncWebhook';
import { getTestDatabaseUrl } from '../../test/dbUrl';

const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

async function clean() {
  await prisma.webhook.deleteMany();
}

describe('ensureSearchSyncWebhook', () => {
  beforeEach(clean);
  afterEach(clean);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates one INTERNAL search-sync webhook with the 4 events and null url/secret', async () => {
    await ensureSearchSyncWebhook(prisma);
    const rows = await prisma.webhook.findMany();
    expect(rows).toHaveLength(1);
    const w = rows[0]!;
    expect(w.kind).toBe('INTERNAL');
    expect(w.name).toBe(SEARCH_SYNC_WEBHOOK_NAME);
    expect(w.url).toBeNull();
    expect(w.secret).toBeNull();
    expect(w.enabled).toBe(true);
    expect([...w.events].sort()).toEqual([...SEARCH_SYNC_EVENTS].sort());
    expect(w.contentTypeIds).toEqual([]);
  });

  it('is idempotent — a second call leaves exactly one INTERNAL row', async () => {
    await ensureSearchSyncWebhook(prisma);
    await ensureSearchSyncWebhook(prisma);
    expect(await prisma.webhook.count({ where: { kind: 'INTERNAL' } })).toBe(1);
  });

  it('does not re-enable a row an operator disabled (converges events, not enabled)', async () => {
    await ensureSearchSyncWebhook(prisma);
    const before = await prisma.webhook.findFirstOrThrow({
      where: { kind: 'INTERNAL' },
    });
    await prisma.webhook.update({
      where: { id: before.id },
      data: { enabled: false },
    });
    await ensureSearchSyncWebhook(prisma);
    const after = await prisma.webhook.findFirstOrThrow({
      where: { kind: 'INTERNAL' },
    });
    expect(after.enabled).toBe(false);
    expect([...after.events].sort()).toEqual([...SEARCH_SYNC_EVENTS].sort());
  });
});
