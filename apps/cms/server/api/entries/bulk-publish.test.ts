import { describe, it, expect } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { getTestDatabaseUrl } from '../../../test/dbUrl';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getTestDatabaseUrl() }),
});

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

type BulkResult = {
  results: Array<{ id: string; ok: boolean; error?: string }>;
  published: number;
  failed: number;
};

async function makeType(identifier: string): Promise<string> {
  const ct = await prisma.contentType.create({
    data: {
      identifier,
      name: identifier,
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        ],
      },
    },
  });
  return ct.id;
}

async function makeEntry(
  contentTypeId: string,
  title: string,
  key: string,
  status: string
) {
  return prisma.contentEntry.create({
    data: {
      contentTypeId,
      entryTitle: title,
      entryKey: key,
      slug: key,
      versions: {
        create: {
          data: { title },
          entryTitle: title,
          status: status as never,
          publishedAt:
            status === CONTENT_STATUSES.PUBLISHED ? new Date() : null,
        },
      },
    },
  });
}

async function bulkPublish(ids: unknown, key?: string, ip = '203.0.113.210') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip,
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  } else {
    headers['cookie'] = await getSessionCookie();
  }
  return fetch('/api/entries/bulk-publish', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids }),
  });
}

describe('POST /api/entries/bulk-publish', async () => {
  // #341: trust X-Forwarded-For (getClientIp defaults to socket peer) so
  // per-IP-bucketing tests keep working.
  await setup({ dev: true, env: { BOJECT_TRUSTED_PROXY_HOPS: '1' } });

  it('publishes every draft id and reports the count', async () => {
    const ct = await makeType(`BulkPubA_${Date.now()}`);
    const a = await makeEntry(
      ct,
      'A1',
      `a1-${Date.now()}`,
      CONTENT_STATUSES.DRAFT
    );
    const b = await makeEntry(
      ct,
      'B1',
      `b1-${Date.now()}`,
      CONTENT_STATUSES.DRAFT
    );
    const res = await bulkPublish([a.id, b.id]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BulkResult;
    expect(body.published).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results.every((r) => r.ok)).toBe(true);
    for (const id of [a.id, b.id]) {
      const v = await prisma.contentEntryVersion.findFirst({
        where: { entryId: id, status: 'PUBLISHED' },
      });
      expect(v).not.toBeNull();
    }
  });

  it('reports partial failure: a missing id is NOT_FOUND, real drafts still publish', async () => {
    const ct = await makeType(`BulkPubB_${Date.now()}`);
    const a = await makeEntry(
      ct,
      'A2',
      `a2-${Date.now()}`,
      CONTENT_STATUSES.DRAFT
    );
    // RFC-4122 v4 shape (version nibble 4, variant nibble 8) so the repo's
    // strict `isUuid` accepts it and it reaches the NOT_FOUND branch rather
    // than being filtered out before the loop.
    const missing = '11111111-1111-4111-8111-111111111111';
    const body = (await (
      await bulkPublish([a.id, missing])
    ).json()) as BulkResult;
    expect(body.published).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === missing)?.error).toBe('NOT_FOUND');
    expect(body.results.find((r) => r.id === a.id)?.ok).toBe(true);
  });

  it('enqueues ENTRY_PUBLISHED per published entry', async () => {
    const ct = await makeType(`BulkPubC_${Date.now()}`);
    // The internal search-sync webhook (the ENTRY_PUBLISHED subscriber) is not
    // seeded in test mode, so create an explicit subscriber scoped to this type
    // — mirrors the single-entry publish suite's webhook wiring tests.
    const hook = await prisma.webhook.create({
      data: {
        name: `Bulk publish hook ${Date.now()}`,
        url: 'https://example.com/hook',
        secret: 'test-secret',
        enabled: true,
        events: ['ENTRY_PUBLISHED'],
        contentTypeIds: [ct],
      },
    });
    const a = await makeEntry(
      ct,
      'A3',
      `a3-${Date.now()}`,
      CONTENT_STATUSES.DRAFT
    );
    await bulkPublish([a.id]);
    // Scope the count to THIS test's webhook. Other integration files leave
    // all-types ENTRY_PUBLISHED subscribers in the shared boject_test DB; an
    // (event, entryId)-only count would sweep those in and flake order-
    // dependently. Mirrors the single-entry publish suite's webhookId scoping.
    const count = await prisma.webhookDelivery.count({
      where: { webhookId: hook.id, event: 'ENTRY_PUBLISHED', entryId: a.id },
    });
    expect(count).toBe(1);
  });

  it('400s on empty / non-array / over-cap ids', async () => {
    expect((await bulkPublish([])).status).toBe(400);
    expect((await bulkPublish('nope')).status).toBe(400);
    // RFC-4122 v4 shape (version 4, variant 8) so all 101 survive `isUuid` and
    // the >MAX_BULK_IDS branch fires (rather than the "valid UUID" 400).
    const tooMany = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    expect((await bulkPublish(tooMany)).status).toBe(400);
  });

  it('reports NOTHING_TO_PUBLISH for an entry with only an ARCHIVED version', async () => {
    const ct = await makeType(`BulkPubD_${Date.now()}`);
    const archived = await makeEntry(
      ct,
      'Arch',
      `arch-${Date.now()}`,
      CONTENT_STATUSES.ARCHIVED
    );
    const body = (await (
      await bulkPublish([archived.id], undefined, '203.0.113.211')
    ).json()) as BulkResult;
    expect(body.published).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]?.error).toBe('NOTHING_TO_PUBLISH');
  });

  it('401s for any API key (session-only path under default-deny allowlist, #257)', async () => {
    const raw = `boject_test_no_write_${Date.now()}`;
    const { createHash } = await import('node:crypto');
    const created = await prisma.apiKey.create({
      data: {
        name: raw,
        keyHash: createHash('sha256').update(raw).digest('hex'),
        keyPrefix: raw.slice(0, 11),
        scopes: ['content:read'],
      },
    });
    try {
      const res = await bulkPublish(
        ['11111111-1111-4111-8111-111111111111'],
        raw
      );
      // /api/entries/bulk-publish is session-only; token is rejected at
      // the middleware before the scope gate.
      expect(res.status).toBe(401);
    } finally {
      await prisma.apiKey.delete({ where: { id: created.id } });
    }
  });
});
