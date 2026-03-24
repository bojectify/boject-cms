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

describe('Tag endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/tags', () => {
    it('returns all tags', async () => {
      const { items, total } = await getList('tags');
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items } = await getList('tags', { status: 'PUBLISHED' });
      expect(items.every((t) => t.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT returns empty', async () => {
      const { items, total } = await getList('tags', { status: 'DRAFT' });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('tags', { status: 'INVALID' });
      expect(total).toBe(3);
    });

    it('paginates results', async () => {
      const { items } = await getList('tags', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/tags/:id', () => {
    it('returns a single tag', async () => {
      const { items } = await getList('tags');
      const tag = await $fetch<Record<string, unknown>>(
        `/api/tags/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(tag.id).toBe(items[0]!.id);
      expect(tag.name).toBeDefined();
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/tags/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/tags/:id', () => {
    it('updates tag name', async () => {
      const { items } = await getList('tags');
      const id = items.find((t) => t.name === 'Youth')?.id ?? items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(`/api/tags/${id}`, {
        method: 'PUT',
        headers: { Cookie: await getSessionCookie() },
        body: { name: 'Youth' },
      });
      expect(updated.name).toBe('Youth');
    });
  });

  describe('GET /api/tags/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/tags/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options[0]!).toHaveProperty('label');
      expect(options[0]!).toHaveProperty('value');
    });
  });

  describe('POST /api/tags', () => {
    it('creates a tag with valid data', async () => {
      const name = `Test Tag ${Date.now()}`;
      const slug = `test-tag-${Date.now()}`;
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name, slug }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe(name);
      expect(body.slug).toBe(slug);
      expect(body.status).toBe('DRAFT');
    });

    it('returns 400 when name is missing', async () => {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ slug: 'some-slug' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when slug is missing', async () => {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: 'Some Tag' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 409 for duplicate name or slug', async () => {
      const name = `Dup Tag ${Date.now()}`;
      const slug = `dup-tag-${Date.now()}`;
      const cookie = await getSessionCookie();

      await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name, slug }),
      });

      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name, slug }),
      });

      expect(response.status).toBe(409);
    });
  });
});
