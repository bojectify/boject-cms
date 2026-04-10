import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type NavResponse = {
  items: { id: string; order: number; parentId: string | null }[];
  total: number;
};

describe('NavigationItem endpoints', async () => {
  await setup({ dev: true });

  let navigationId: string;
  let linkId: string;

  it('setup: get navigation and create a test link', async () => {
    const navs = await $fetch<{ items: { id: string }[]; total: number }>(
      '/api/navigations',
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    navigationId = navs.items[0]!.id;

    const response = await fetch('/api/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({
        label: `NavItem Test ${Date.now()}`,
        url: '/nav-test',
      }),
    });
    const link = await response.json();
    linkId = link.id;
  });

  describe('GET /api/navigation-items', () => {
    it('returns items for a navigation', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(Array.isArray(items)).toBe(true);
    });

    it('returns 400 without navigationId', async () => {
      const err = await $fetch('/api/navigation-items', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });
  });

  describe('POST /api/navigation-items', () => {
    it('creates a top-level item', async () => {
      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          order: 99,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.linkId).toBe(linkId);
      expect(body.navigationId).toBe(navigationId);
      expect(body.parentId).toBeNull();
    });

    it('creates a child item', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const parentId = items.find((i) => !i.parentId)?.id;

      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          parentId,
          order: 0,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.parentId).toBe(parentId);
    });

    it('rejects nesting beyond two levels', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const childItem = items.find((i) => i.parentId);

      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          parentId: childItem?.id,
          order: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/navigation-items/:id', () => {
    it('deletes an item without deleting the link', async () => {
      // Create an item to delete
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 999 }),
      });
      const created = await createRes.json();

      const deleteRes = await fetch(`/api/navigation-items/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
      expect(deleteRes.status).toBe(200);

      // Link should still exist
      const link = await $fetch<Record<string, unknown>>(
        `/api/links/${linkId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(link.id).toBe(linkId);
    });
  });

  describe('PUT /api/navigation-items/reorder', () => {
    it('bulk updates order values', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const topLevel = items.filter((i) => !i.parentId);
      if (topLevel.length < 2) return; // skip if not enough items

      const reordered = topLevel.map((item, idx) => ({
        id: item.id,
        order: topLevel.length - 1 - idx,
        parentId: null,
      }));

      const updated = await $fetch<{ id: string; order: number }[]>(
        '/api/navigation-items/reorder',
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { items: reordered },
        }
      );

      expect(Array.isArray(updated)).toBe(true);
    });
  });
});
