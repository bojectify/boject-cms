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
});
