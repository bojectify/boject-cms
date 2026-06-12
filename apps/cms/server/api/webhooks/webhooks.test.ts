import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { prisma } from '../../utils/prisma';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

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

describe('Webhooks REST', async () => {
  await setup({ dev: true });
  beforeAll(() => resetRateLimitStore());

  describe('POST /api/webhooks', () => {
    it('creates a webhook and returns the secret exactly once', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Test 1',
          url: 'https://example.com/a',
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; secret: string };
      expect(body.secret).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(
        Buffer.from(body.secret, 'base64').byteLength
      ).toBeGreaterThanOrEqual(32);

      const getRes = await fetch(`/api/webhooks/${body.id}`, {
        headers: { Cookie: cookie },
      });
      const detail = (await getRes.json()) as Record<string, unknown>;
      expect(detail.secret).toBeUndefined();
    });

    it('rejects invalid URL', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'bad',
          url: 'not a url',
          events: ['ENTRY_PUBLISHED'],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects empty events array', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'no events',
          url: 'https://example.com',
          events: [],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects subscribing to the internal-only ENTRY_DRAFT_SYNC event', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'draft-sync',
          url: 'https://example.com/draft-sync',
          events: ['ENTRY_DRAFT_SYNC'],
          contentTypeIds: [],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { statusMessage?: string };
      expect(body.statusMessage).toBe('events[0] is not a valid WebhookEvent');
    });

    it('rejects API-key callers', async () => {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          name: 'apikey',
          url: 'https://example.com',
          events: ['ENTRY_PUBLISHED'],
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/webhooks', () => {
    it('returns the list without secrets', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.every((i) => i.secret === undefined)).toBe(true);
    });
  });

  describe('PUT /api/webhooks/:id', () => {
    it('updates fields but does not return the secret', async () => {
      const cookie = await getSessionCookie();
      const created = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'Upd-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/webhooks/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ enabled: false, name: 'Upd-1-renamed' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.secret).toBeUndefined();
      expect(body.enabled).toBe(false);
      expect(body.name).toBe('Upd-1-renamed');
    });

    it('returns 404 when webhook does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name: 'nope' }),
        }
      );
      expect(res.status).toBe(404);
    });

    it('rejects invalid URL on update', async () => {
      const cookie = await getSessionCookie();
      const created = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'Upd-URL',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/webhooks/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ url: 'not a url' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects API-key callers on PUT', async () => {
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({ name: 'blocked' }),
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('deletes the webhook and cascades deliveries', async () => {
      const cookie = await getSessionCookie();
      const created = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'Del-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      // Seed a delivery directly so the cascade has something to clean up.
      await prisma.webhookDelivery.create({
        data: {
          webhookId: created.id,
          event: 'ENTRY_PUBLISHED',
          contentTypeId: '00000000-0000-0000-0000-000000000000',
          entryId: '00000000-0000-0000-0000-000000000000',
          payload: { seed: true },
          status: 'PENDING',
        },
      });

      const deliveriesBefore = await prisma.webhookDelivery.findMany({
        where: { webhookId: created.id },
      });
      expect(deliveriesBefore.length).toBe(1);

      const res = await fetch(`/api/webhooks/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);

      const getRes = await fetch(`/api/webhooks/${created.id}`, {
        headers: { Cookie: cookie },
      });
      expect(getRes.status).toBe(404);

      const deliveriesAfter = await prisma.webhookDelivery.findMany({
        where: { webhookId: created.id },
      });
      expect(deliveriesAfter.length).toBe(0);
    });

    it('returns 404 when webhook does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111',
        {
          method: 'DELETE',
          headers: { Cookie: cookie },
        }
      );
      expect(res.status).toBe(404);
    });

    it('rejects API-key callers on DELETE', async () => {
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111',
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/webhooks/:id/rotate', () => {
    it('rotates the secret and returns the new one once', async () => {
      const cookie = await getSessionCookie();
      const created = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'Rot-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string; secret: string };

      const res = await fetch(`/api/webhooks/${created.id}/rotate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { secret: string };
      expect(body.secret).not.toBe(created.secret);
      expect(
        Buffer.from(body.secret, 'base64').byteLength
      ).toBeGreaterThanOrEqual(32);
    });

    it('returns 404 when webhook does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111/rotate',
        {
          method: 'POST',
          headers: { Cookie: cookie },
        }
      );
      expect(res.status).toBe(404);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111/rotate',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/webhooks/:id/test', () => {
    it('enqueues a test delivery row', async () => {
      const cookie = await getSessionCookie();
      const created = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'Test-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/webhooks/${created.id}/test`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        deliveryId: string;
        isTest: boolean;
      };
      expect(body.isTest).toBe(true);

      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: body.deliveryId },
      });
      expect(delivery).not.toBeNull();
      expect(delivery!.isTest).toBe(true);
      expect(delivery!.webhookId).toBe(created.id);
      expect(delivery!.status).toBe('PENDING');
      const payload = delivery!.payload as {
        event: string;
        test?: boolean;
        deliveryId: string;
      };
      expect(payload.event).toBe('ENTRY_PUBLISHED');
      expect(payload.test).toBe(true);
      expect(payload.deliveryId).toBe(body.deliveryId);
    });

    it('returns 404 when webhook does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111/test',
        {
          method: 'POST',
          headers: { Cookie: cookie },
        }
      );
      expect(res.status).toBe(404);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111/test',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    it('returns paginated deliveries for a webhook', async () => {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'D-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      // Trigger a test delivery so we have something in the list.
      await fetch(`/api/webhooks/${hook.id}/test`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });

      const res = await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ event: string; status: string; isTest: boolean }>;
        total: number;
      };
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThan(0);
      expect(body.items[0]!.isTest).toBe(true);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/webhooks/11111111-1111-4111-8111-111111111111/deliveries',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/webhooks/deliveries/:id/retry', () => {
    it('requeues a FAILED / DEAD_LETTERED delivery as a new PENDING row', async () => {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: 'R-1',
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const dead = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event: 'ENTRY_PUBLISHED',
          contentTypeId: '00000000-0000-0000-0000-000000000000',
          entryId: '00000000-0000-0000-0000-000000000000',
          payload: { reused: true },
          status: 'DEAD_LETTERED',
          attempts: 6,
        },
      });

      const res = await fetch(`/api/webhooks/deliveries/${dead.id}/retry`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(201);
      const { deliveryId } = (await res.json()) as { deliveryId: string };
      expect(deliveryId).not.toBe(dead.id);

      const requeued = await prisma.webhookDelivery.findUnique({
        where: { id: deliveryId },
      });
      expect(requeued?.status).toBe('PENDING');
      expect(requeued?.attempts).toBe(0);
      expect((requeued?.payload as { reused: boolean }).reused).toBe(true);
    });

    it('returns 404 when delivery does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/deliveries/11111111-1111-4111-8111-111111111111/retry',
        {
          method: 'POST',
          headers: { Cookie: cookie },
        }
      );
      expect(res.status).toBe(404);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/webhooks/deliveries/11111111-1111-4111-8111-111111111111/retry',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/webhooks/deliveries/:id/cancel', () => {
    it('cancels a PENDING delivery that has at least one attempt', async () => {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: `C-1 ${Date.now()}`,
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const pending = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event: 'ENTRY_PUBLISHED',
          contentTypeId: '00000000-0000-0000-0000-000000000000',
          entryId: '00000000-0000-0000-0000-000000000000',
          payload: { hello: 'world' },
          status: 'PENDING',
          attempts: 2,
          nextAttemptAt: new Date(Date.now() + 60_000),
          lastResponseCode: 500,
        },
      });

      const res = await fetch(`/api/webhooks/deliveries/${pending.id}/cancel`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);

      const cancelled = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(cancelled.status).toBe('FAILED');
      expect(cancelled.lastError).toBe('Cancelled by editor');
      expect(cancelled.completedAt).toBeInstanceOf(Date);
      expect(cancelled.nextAttemptAt).toBeNull();
      expect(cancelled.attempts).toBe(2);
    });

    it('returns 409 when the delivery is already SUCCESS', async () => {
      const cookie = await getSessionCookie();
      const hook = (await (
        await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            name: `C-2 ${Date.now()}`,
            url: 'https://example.com/x',
            events: ['ENTRY_PUBLISHED'],
          }),
        })
      ).json()) as { id: string };

      const done = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event: 'ENTRY_PUBLISHED',
          contentTypeId: '00000000-0000-0000-0000-000000000000',
          entryId: '00000000-0000-0000-0000-000000000000',
          payload: {},
          status: 'SUCCESS',
          attempts: 1,
          completedAt: new Date(),
        },
      });

      const res = await fetch(`/api/webhooks/deliveries/${done.id}/cancel`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('ALREADY_COMPLETED');
    });

    it('returns 404 when the delivery does not exist', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/webhooks/deliveries/11111111-1111-4111-8111-111111111111/cancel',
        { method: 'POST', headers: { Cookie: cookie } }
      );
      expect(res.status).toBe(404);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/webhooks/deliveries/11111111-1111-4111-8111-111111111111/cancel',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('internal webhook guards', () => {
    async function createInternalWebhook() {
      return prisma.webhook.create({
        data: {
          name: 'Search index sync',
          kind: 'INTERNAL',
          url: null,
          secret: null,
          enabled: true,
          contentTypeIds: [],
          events: ['ENTRY_PUBLISHED'],
        },
      });
    }

    it('GET list and detail expose kind', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const list = await fetch('/api/webhooks', {
          headers: { Cookie: cookie },
        });
        const listBody = await list.json();
        const row = listBody.items.find(
          (w: { id: string }) => w.id === internal.id
        );
        expect(row.kind).toBe('INTERNAL');

        const detail = await fetch(`/api/webhooks/${internal.id}`, {
          headers: { Cookie: cookie },
        });
        const detailBody = await detail.json();
        expect(detailBody.kind).toBe('INTERNAL');
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });

    it('DELETE refuses an internal webhook (409) and the row survives', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const res = await fetch(`/api/webhooks/${internal.id}`, {
          method: 'DELETE',
          headers: { Cookie: cookie },
        });
        expect(res.status).toBe(409);
        const still = await prisma.webhook.findUnique({
          where: { id: internal.id },
        });
        expect(still).not.toBeNull();
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });

    it('PUT allows toggling enabled on an internal webhook', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const res = await fetch(`/api/webhooks/${internal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ enabled: false }),
        });
        expect(res.status).toBe(200);
        const updated = await prisma.webhook.findUnique({
          where: { id: internal.id },
        });
        expect(updated?.enabled).toBe(false);
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });

    it('PUT rejects changing url/events on an internal webhook (400)', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const urlRes = await fetch(`/api/webhooks/${internal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ url: 'https://evil.example.com' }),
        });
        expect(urlRes.status).toBe(400);

        const eventsRes = await fetch(`/api/webhooks/${internal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ events: ['ENTRY_DELETED'] }),
        });
        expect(eventsRes.status).toBe(400);
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });

    it('POST /rotate refuses an internal webhook (409)', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const res = await fetch(`/api/webhooks/${internal.id}/rotate`, {
          method: 'POST',
          headers: { Cookie: cookie },
        });
        expect(res.status).toBe(409);
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });

    it('POST /test refuses an internal webhook (409)', async () => {
      const cookie = await getSessionCookie();
      const internal = await createInternalWebhook();
      try {
        const res = await fetch(`/api/webhooks/${internal.id}/test`, {
          method: 'POST',
          headers: { Cookie: cookie },
        });
        expect(res.status).toBe(409);
      } finally {
        await prisma.webhook.delete({ where: { id: internal.id } });
      }
    });
  });
});
