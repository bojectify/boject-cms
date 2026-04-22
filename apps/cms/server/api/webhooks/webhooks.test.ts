import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

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
});
