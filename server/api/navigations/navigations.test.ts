import { describe, it, expect, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type ListItem = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type ListResponse = { items: ListItem[]; total: number };

describe('Navigation endpoints', async () => {
  await setup({ dev: true });

  beforeEach(() => {
    resetRateLimitStore();
  });

  describe('GET /api/navigations', () => {
    it('returns all navigations', async () => {
      const { items, total } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/navigations/:id', () => {
    it('returns navigation with nested items and links', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const nav = await $fetch<Record<string, unknown>>(
        `/api/navigations/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(nav.id).toBe(items[0]!.id);
      expect(nav.name).toBeDefined();
      expect(Array.isArray(nav.items)).toBe(true);
    });

    it('returns items ordered by order field', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const nav = await $fetch<{
        items: { order: number; children: { order: number }[] }[];
      }>(`/api/navigations/${items[0]!.id}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const orders = nav.items.map((i) => i.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/navigations/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/navigations/:id', () => {
    it('updates navigation name', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const id = items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/navigations/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { name: 'Main Navigation' },
        }
      );
      expect(updated.name).toBe('Main Navigation');
    });

    it('rejects invalid UUID in path param', async () => {
      const response = await fetch('/api/navigations/not-a-uuid', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: 'Irrelevant' }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects a name longer than 200 chars', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const id = items[0]!.id;

      const response = await fetch(`/api/navigations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: 'A'.repeat(201) }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects an entryTitle longer than 200 chars', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const id = items[0]!.id;

      const response = await fetch(`/api/navigations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: 'short', entryTitle: 'A'.repeat(201) }),
      });
      expect(response.status).toBe(400);
    });
  });
});
