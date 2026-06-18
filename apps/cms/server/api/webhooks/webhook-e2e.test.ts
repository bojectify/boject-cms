import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../utils/prisma';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { runWorkerTick } from '../../utils/webhookWorker';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

// This test relies on the symmetric escape hatch from issue #103: when
// `NODE_ENV !== 'production'` (or `WEBHOOK_ALLOW_PRIVATE_URLS=true`), both
// the validate-time DNS resolution and the dispatch-time IP pinning are
// skipped, allowing the 127.0.0.1 stub server below to receive deliveries.
// If you tighten the bypass logic in webhookUrl.ts / webhookWorker.ts, this
// suite will start failing — that's the intended signal, not a flake.

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

/**
 * Start an HTTP server that records every POST it receives and replies via
 * the caller-supplied handler. Returns the base URL (http://127.0.0.1:PORT/).
 */
async function startStub(
  received: Array<{ headers: Record<string, string>; body: string }>,
  handler: (
    headers: Record<string, string>,
    body: string
  ) => { status: number; body?: string }
): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') hdrs[k] = v;
        }
        received.push({ headers: hdrs, body: raw });
        const { status, body } = handler(hdrs, raw);
        res.statusCode = status;
        res.end(body ?? '');
      });
    }).listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}

/**
 * Run one worker tick inside the test process. Shares the same Postgres DB
 * as the dev server's Prisma client, so enqueued rows are visible.
 *
 * Cast `prisma` to `never` to satisfy the narrower WorkerPrisma interface
 * declared in webhookWorker.ts (real Prisma client satisfies it structurally).
 */
async function tickWorker(): Promise<void> {
  await runWorkerTick({
    prisma: prisma as never,
    // Use Node's global fetch for outbound webhook HTTP calls — the
    // Nuxt test-utils `fetch` resolves against the dev server's base URL and
    // would treat an absolute http://127.0.0.1:PORT/ URL as a nested path.
    fetch: (url, init) => globalThis.fetch(url, init),
    now: () => new Date(),
  });
}

describe('Webhook delivery E2E', async () => {
  await setup({ dev: true });
  beforeAll(() => resetRateLimitStore());
  // Each test registers a fresh webhook pointing at its own stub server and
  // purges prior webhooks + PENDING rows. Without this, earlier tests'
  // webhooks (subscribed to ENTRY_PUBLISHED, URLs pointing to closed stub
  // ports) would receive enqueued deliveries on subsequent publishes,
  // polluting the worker's FIFO batch and potentially stalling it on
  // unreachable ports.
  beforeEach(async () => {
    // Order matters: deliveries cascade on webhook delete, so clearing
    // webhooks first would drop all their deliveries too. The explicit
    // deleteMany on PENDING here also catches stray rows from other test
    // files (e.g. `webhooks.test.ts` seeds a delivery to
    // `https://example.com/x`).
    await prisma.webhookDelivery.deleteMany({});
    await prisma.webhook.deleteMany({});
  });

  it('delivers a published entry to the stub on first try', async () => {
    const received: Array<{ headers: Record<string, string>; body: string }> =
      [];
    const { url: stubUrl, server } = await startStub(received, () => ({
      status: 200,
      body: 'ok',
    }));

    try {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'E2E publish',
            url: stubUrl,
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string; secret: string };

      const ct = await prisma.contentType.upsert({
        where: { identifier: 'E2EBlog' },
        update: {},
        create: {
          identifier: 'E2EBlog',
          name: 'E2E Blog',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });
      const entry = (await (
        await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `E2E publish ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/entries/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: entry.data,
        }),
      });

      // Manually invoke one worker tick in-process.
      await tickWorker();

      expect(received.length).toBeGreaterThan(0);

      const delivery = received[0]!;
      expect(delivery.headers['x-boject-event']).toBe('ENTRY_PUBLISHED');
      const timestamp = delivery.headers['x-boject-timestamp'];
      const sigHeader = delivery.headers['x-boject-signature']!;
      const expected = createHmac('sha256', hook.secret)
        .update(`${timestamp}.${delivery.body}`)
        .digest('hex');
      expect(sigHeader).toBe(`sha256=${expected}`);

      const parsed = JSON.parse(delivery.body) as {
        event: string;
        entry: { status: string; data: { title: string } };
      };
      expect(parsed.event).toBe('ENTRY_PUBLISHED');
      expect(parsed.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(parsed.entry.data.title).toBe(entry.data.title);

      const row = await prisma.webhookDelivery.findFirstOrThrow({
        where: { webhookId: hook.id },
      });
      expect(row.lastRequestHeaders).toMatchObject({
        'Content-Type': 'application/json',
        'X-Boject-Event': 'ENTRY_PUBLISHED',
      });
    } finally {
      server.close();
    }
  });

  it('retries a 500 and succeeds on the next tick', async () => {
    const received: Array<{ headers: Record<string, string>; body: string }> =
      [];
    let callCount = 0;
    const { url: stubUrl, server } = await startStub(received, () => {
      callCount += 1;
      return callCount === 1
        ? { status: 500, body: 'boom' }
        : { status: 200, body: 'ok' };
    });

    try {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'E2E retry',
            url: stubUrl,
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      // Fire a test delivery (avoids needing to publish again).
      await fetch(`/api/webhooks/${hook.id}/test`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });

      // First tick: 500, worker schedules retry at now+1s.
      await tickWorker();
      expect(callCount).toBe(1);

      const afterFirst = await prisma.webhookDelivery.findFirst({
        where: { webhookId: hook.id, isTest: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(afterFirst?.status).toBe('PENDING');
      expect(afterFirst?.attempts).toBe(1);

      // Manually set nextAttemptAt to the past so the second tick picks it up
      // immediately (avoids waiting 1s for the real backoff).
      await prisma.webhookDelivery.update({
        where: { id: afterFirst!.id },
        data: { nextAttemptAt: new Date(0) },
      });

      // Second tick: 200, marks SUCCESS.
      await tickWorker();
      expect(callCount).toBe(2);

      const afterSecond = await prisma.webhookDelivery.findUnique({
        where: { id: afterFirst!.id },
      });
      expect(afterSecond?.status).toBe('SUCCESS');
      expect(afterSecond?.attempts).toBe(2);
    } finally {
      server.close();
    }
  });

  it('delivers ENTRY_UNPUBLISHED end-to-end when an entry is unpublished', async () => {
    const received: Array<{ headers: Record<string, string>; body: string }> =
      [];
    const { url: stubUrl, server } = await startStub(received, () => ({
      status: 200,
      body: 'ok',
    }));

    try {
      const cookie = await getSessionCookie();
      await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'E2E unpublish',
            url: stubUrl,
            events: ['ENTRY_UNPUBLISHED'],
          }),
        })
      ).json();

      const ct = await prisma.contentType.upsert({
        where: { identifier: 'E2EBlog' },
        update: {},
        create: {
          identifier: 'E2EBlog',
          name: 'E2E Blog',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });
      const entry = (await (
        await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `E2E unpub ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/entries/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: entry.data,
        }),
      });
      await fetch(`/api/entries/${entry.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });

      await tickWorker();

      expect(received.length).toBeGreaterThan(0);
      const parsed = JSON.parse(received[0]!.body) as {
        event: string;
        entry: { status: string; data: { title: string } };
      };
      expect(parsed.event).toBe('ENTRY_UNPUBLISHED');
      expect(parsed.entry.status).toBe(CONTENT_STATUSES.PUBLISHED); // snapshot of pre-demotion state
      expect(parsed.entry.data.title).toBe(entry.data.title);
    } finally {
      server.close();
    }
  });
});
