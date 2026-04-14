import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

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

function getList(model: string, params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ListResponse>(`/api/${model}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

describe('Link endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/links', () => {
    it('returns all links', async () => {
      const { items, total } = await getList('links');
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', async () => {
      const { items } = await getList('links', { status: 'PUBLISHED' });
      expect(items.every((l) => l.status === 'PUBLISHED')).toBe(true);
    });

    it('paginates results', async () => {
      const { items } = await getList('links', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/links/:id', () => {
    it('returns a single link with article', async () => {
      const { items } = await getList('links');
      const link = await $fetch<Record<string, unknown>>(
        `/api/links/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(link.id).toBe(items[0]!.id);
      expect(link.label).toBeDefined();
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/links/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('POST /api/links', () => {
    it('creates a link with url', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ label: 'Test Link', url: '/test-page' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.label).toBe('Test Link');
      expect(body.url).toBe('/test-page');
      expect(body.status).toBe('DRAFT');
    });

    it('returns 400 when label is missing', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ url: '/some-page' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when both url and articleId are missing', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ label: 'Empty Link' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/links/:id', () => {
    it('updates link label', async () => {
      const { items } = await getList('links');
      const id = items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/links/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { label: 'Updated Label' },
        }
      );
      expect(updated.label).toBe('Updated Label');
    });
  });

  describe('GET /api/links/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/links/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0]!).toHaveProperty('label');
      expect(options[0]!).toHaveProperty('value');
    });
  });
});
