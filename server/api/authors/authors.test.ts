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

describe('Author endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/authors', () => {
    it('returns all authors', async () => {
      const { items, total } = await getList('authors');
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('authors', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('authors', {
        status: 'DRAFT',
      });
      expect(items.every((a) => a.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('authors', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(2);
    });

    it('paginates results', async () => {
      const { items } = await getList('authors', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/authors/:id', () => {
    it('returns a single author with socialLinks', async () => {
      const { items } = await getList('authors');
      const firstItem = items[0]!;
      const author = await $fetch<Record<string, unknown>>(
        `/api/authors/${firstItem.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(author.id).toBe(firstItem.id);
      expect(author.name).toBeDefined();
      expect(author.socialLinks).toBeDefined();
      expect(Array.isArray(author.socialLinks)).toBe(true);
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/authors/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/authors/:id', () => {
    it('updates author name', async () => {
      const { items } = await getList('authors');
      const id =
        items.find((a) => a.name === 'Gareth Jones')?.id ?? items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/authors/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { name: 'Gareth Jones', bio: 'Updated bio.' },
        }
      );
      expect(updated.bio).toBe('Updated bio.');
    });

    it('replaces social links on save', async () => {
      const { items } = await getList('authors');
      const id =
        items.find((a) => a.name === 'Sarah Davies')?.id ?? items[1]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/authors/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: {
            socialLinks: [
              { platform: 'twitter', url: 'https://twitter.com/new' },
            ],
          },
        }
      );
      const links = (updated as Record<string, unknown>).socialLinks as Array<{
        platform: string;
        url: string;
      }>;
      expect(links).toHaveLength(1);
      expect(links[0]!.platform).toBe('twitter');
    });

    it('clears social links with empty array', async () => {
      const { items } = await getList('authors');
      const id =
        items.find((a) => a.name === 'Sarah Davies')?.id ?? items[1]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/authors/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { socialLinks: [] },
        }
      );
      const links = (updated as Record<string, unknown>)
        .socialLinks as unknown[];
      expect(links).toHaveLength(0);
    });
  });

  describe('GET /api/authors/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/authors/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options[0]!).toHaveProperty('label');
      expect(options[0]!).toHaveProperty('value');
    });
  });

  // ── POST /api/authors ────────────────────────────────────────

  describe('POST /api/authors', () => {
    let createdName: string;

    it('creates an author with valid data', async () => {
      createdName = `Test Author ${Date.now()}`;
      const slug = `test-author-${Date.now()}`;
      const response = await fetch('/api/authors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name: createdName,
          slug,
        }),
      });
      expect(response.status).toBe(201);
      const author = await response.json();
      expect(author.id).toBeDefined();
      expect(author.name).toBe(createdName);
      expect(author.slug).toBe(slug);
      expect(author.status).toBe('DRAFT');
    });

    it('creates an author with socialLinks', async () => {
      const name = `Social Author ${Date.now()}`;
      const slug = `social-author-${Date.now()}`;
      const response = await fetch('/api/authors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name,
          slug,
          socialLinks: [
            { platform: 'twitter', url: 'https://twitter.com/social' },
            { platform: 'instagram', url: 'https://instagram.com/social' },
          ],
        }),
      });
      expect(response.status).toBe(201);
      const author = await response.json();
      expect(author.socialLinks).toHaveLength(2);
      expect(author.socialLinks[0].platform).toBe('twitter');
    });

    it('returns 400 when name is missing', async () => {
      const err = await $fetch('/api/authors', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { slug: 'no-name' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when slug is missing', async () => {
      const err = await $fetch('/api/authors', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name: 'No Slug Author' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 409 on duplicate name', async () => {
      const err = await $fetch('/api/authors', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name: createdName, slug: 'test-author-dupe' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        409
      );
    });
  });
});
