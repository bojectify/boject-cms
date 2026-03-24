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

describe('Article endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/articles', () => {
    it('returns all articles', async () => {
      const { items, total } = await getList('articles');
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('articles', {
        status: 'PUBLISHED',
      });
      expect(total).toBe(2);
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items, total } = await getList('articles', {
        status: 'DRAFT',
      });
      expect(total).toBe(1);
      expect(items[0]!.status).toBe('DRAFT');
    });

    it('filters by authorId', async () => {
      const authors = await getList('authors');
      const authorId = authors.items[0]!.id;
      const { items } = await getList('articles', { authorId });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((a) => a.authorId === authorId)).toBe(true);
    });

    it('filters by tagId', async () => {
      const tags = await getList('tags');
      const tagId =
        tags.items.find((t) => t.name === 'Club News')?.id ?? tags.items[0]!.id;
      const { items } = await getList('articles', { tagId });
      expect(items.length).toBeGreaterThan(0);
    });

    it('combines status and authorId filters', async () => {
      const authors = await getList('authors');
      const authorId =
        authors.items.find((a) => a.name === 'Gareth Jones')?.id ??
        authors.items[0]!.id;
      const { items } = await getList('articles', {
        authorId,
        status: 'PUBLISHED',
      });
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
      expect(items.every((a) => a.authorId === authorId)).toBe(true);
    });

    it('paginates results', async () => {
      const { items } = await getList('articles', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/articles/:id', () => {
    it('returns article with author, tags, featuredImage', async () => {
      const { items } = await getList('articles');
      const article = await $fetch<Record<string, unknown>>(
        `/api/articles/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(article.id).toBe(items[0]!.id);
      expect(article.title).toBeDefined();
      expect(article.tags).toBeDefined();
      expect(Array.isArray(article.tags)).toBe(true);
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/articles/00000000-0000-0000-0000-000000000000',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/articles/:id', () => {
    it('updates article fields', async () => {
      const { items } = await getList('articles');
      const id =
        items.find((a) => a.title === 'Opening Day Victory')?.id ??
        items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { summary: 'Updated summary.' },
        }
      );
      expect(updated.summary).toBe('Updated summary.');
    });

    it('assigns tags via tagIds', async () => {
      const { items: articles } = await getList('articles');
      const { items: tags } = await getList('tags');
      const articleId =
        articles.find((a) => a.title === 'Opening Day Victory')?.id ??
        articles[0]!.id;
      const tagIds = tags.slice(0, 2).map((t) => t.id);
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${articleId}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { tagIds },
        }
      );
      const updatedTags = updated.tags as Array<{ id: string }>;
      expect(updatedTags).toHaveLength(2);
    });

    it('saves body as JSON', async () => {
      const { items } = await getList('articles');
      const id = items[0]!.id;
      const body = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test content.' }],
          },
        ],
      };
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { body },
        }
      );
      expect(updated.body).toEqual(body);
    });
  });

  describe('GET /api/images/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/images/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0]!).toHaveProperty('label');
      expect(options[0]!).toHaveProperty('value');
    });
  });

  // ── POST /api/articles ───────────────────────────────────────

  describe('POST /api/articles', () => {
    it('creates an article with valid data', async () => {
      const response = await fetch('/api/articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          title: 'Test Article',
          slug: 'test-article',
          summary: 'A test article summary.',
        }),
      });
      expect(response.status).toBe(201);
      const article = await response.json();
      expect(article.id).toBeDefined();
      expect(article.title).toBe('Test Article');
      expect(article.slug).toBe('test-article');
      expect(article.status).toBe('DRAFT');
    });

    it('creates an article with tagIds', async () => {
      const { items: tags } = await getList('tags');
      const tagIds = tags.slice(0, 2).map((t) => t.id);
      const response = await fetch('/api/articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          title: 'Tagged Article',
          slug: 'tagged-article',
          tagIds,
        }),
      });
      expect(response.status).toBe(201);
      const article = await response.json();
      expect(article.tags).toHaveLength(2);
    });

    it('returns 400 when title is missing', async () => {
      const err = await $fetch('/api/articles', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { slug: 'no-title' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when slug is missing', async () => {
      const err = await $fetch('/api/articles', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { title: 'No Slug Article' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 409 on duplicate title', async () => {
      const err = await $fetch('/api/articles', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { title: 'Test Article', slug: 'test-article-dupe' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        409
      );
    });
  });
});
