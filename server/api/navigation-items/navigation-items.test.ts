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

    it('rejects parentId that does not belong to the same navigation', async () => {
      // Create a parent item under the current (seeded) navigation.
      const parentRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 500 }),
      });
      const parent = await parentRes.json();

      try {
        // POST a child claiming to be in a DIFFERENT navigationId but
        // referencing the parent we just created. Even if that navigationId
        // does not exist, the scoping check on parent.navigationId must fire
        // first and return 400.
        const otherNavId = '00000000-0000-0000-0000-00000000abcd';
        const response = await fetch('/api/navigation-items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: await getSessionCookie(),
          },
          body: JSON.stringify({
            navigationId: otherNavId,
            linkId,
            parentId: parent.id,
            order: 0,
          }),
        });
        expect(response.status).toBe(400);
      } finally {
        // Clean up the parent item so it does not pollute later tests.
        await fetch(
          `/api/navigation-items/${parent.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
    });

    it('rejects invalid UUID in navigationId', async () => {
      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId: 'not-a-uuid',
          linkId,
          order: 0,
        }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects non-integer order', async () => {
      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          order: 1.5,
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

      const deleteRes = await fetch(
        `/api/navigation-items/${created.id}?navigationId=${navigationId}`,
        {
          method: 'DELETE',
          headers: { Cookie: await getSessionCookie() },
        }
      );
      expect(deleteRes.status).toBe(200);

      // Link should still exist
      const link = await $fetch<Record<string, unknown>>(
        `/api/links/${linkId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(link.id).toBe(linkId);
    });

    it('rejects invalid UUID in path param', async () => {
      const response = await fetch('/api/navigation-items/not-a-uuid', {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
      expect(response.status).toBe(400);
    });

    it('rejects delete without navigationId query param', async () => {
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 1100 }),
      });
      const item = await createRes.json();

      try {
        const response = await fetch(`/api/navigation-items/${item.id}`, {
          method: 'DELETE',
          headers: { Cookie: await getSessionCookie() },
        });
        expect(response.status).toBe(400);
      } finally {
        await fetch(
          `/api/navigation-items/${item.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
    });

    it('rejects delete when navigationId does not match the item', async () => {
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 1200 }),
      });
      const item = await createRes.json();

      try {
        const wrongNav = '00000000-0000-0000-0000-00000000dead';
        const response = await fetch(
          `/api/navigation-items/${item.id}?navigationId=${wrongNav}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
        expect(response.status).toBe(400);
      } finally {
        await fetch(
          `/api/navigation-items/${item.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
    });
  });

  describe('PUT /api/navigation-items/:id', () => {
    it('rejects invalid UUID in path param', async () => {
      const response = await fetch('/api/navigation-items/not-a-uuid', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ order: 1 }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects parentId that does not exist', async () => {
      // Create a top-level item to then update
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 700 }),
      });
      const item = await createRes.json();

      try {
        // Use a UUID that is well-formed but does not exist in any navigation.
        const phantom = '00000000-0000-0000-0000-00000000c0de';
        const response = await fetch(`/api/navigation-items/${item.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: await getSessionCookie(),
          },
          body: JSON.stringify({ parentId: phantom }),
        });
        expect(response.status).toBe(400);
      } finally {
        await fetch(
          `/api/navigation-items/${item.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
    });

    it('rejects negative order', async () => {
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 800 }),
      });
      const item = await createRes.json();

      try {
        const response = await fetch(`/api/navigation-items/${item.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: await getSessionCookie(),
          },
          body: JSON.stringify({ order: -1 }),
        });
        expect(response.status).toBe(400);
      } finally {
        await fetch(
          `/api/navigation-items/${item.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
    });

    it('updates order on a valid request', async () => {
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 900 }),
      });
      const item = await createRes.json();

      try {
        const response = await fetch(`/api/navigation-items/${item.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: await getSessionCookie(),
          },
          body: JSON.stringify({ order: 950 }),
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.order).toBe(950);
      } finally {
        await fetch(
          `/api/navigation-items/${item.id}?navigationId=${navigationId}`,
          {
            method: 'DELETE',
            headers: { Cookie: await getSessionCookie() },
          }
        );
      }
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
