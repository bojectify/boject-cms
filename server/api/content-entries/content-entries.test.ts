import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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

type ContentTypeResponse = {
  id: string;
  name: string;
  identifier: string;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    order: number;
    options: unknown;
  }>;
};

type EntryResponse = {
  id: string;
  contentTypeId: string;
  data: Record<string, unknown>;
  slug: string | null;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contentType?: ContentTypeResponse;
};

type ListResponse = { items: EntryResponse[]; total: number };

let testContentType: ContentTypeResponse;

describe('Content Entry endpoints', async () => {
  await setup({ dev: true });

  beforeEach(() => {
    resetRateLimitStore();
  });

  beforeAll(async () => {
    const cookie = await getSessionCookie();
    testContentType = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Entry Test Type ${Date.now()}`,
        description: 'Content type for entry CRUD tests',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          { identifier: 'summary', name: 'Summary', type: 'TEXT' },
          { identifier: 'count', name: 'Count', type: 'NUMBER' },
          { identifier: 'featured', name: 'Featured', type: 'BOOLEAN' },
          { identifier: 'publishDate', name: 'Publish Date', type: 'DATETIME' },
          {
            identifier: 'category',
            name: 'Category',
            type: 'SELECT',
            options: { choices: ['news', 'blog', 'update'] },
          },
          {
            identifier: 'content',
            name: 'Content',
            type: 'RICHTEXT',
          },
        ],
      },
    });
  });

  describe('POST /api/content-entries', () => {
    it('creates an entry with valid data', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: 'First Entry',
            slug: 'first-entry',
            summary: 'A summary',
            count: 42,
            featured: true,
            publishDate: '2025-01-15T10:00:00.000Z',
            category: 'news',
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as EntryResponse;
      expect(body.id).toBeDefined();
      expect(body.contentTypeId).toBe(testContentType.id);
      expect(body.data.title).toBe('First Entry');
      expect(body.data.count).toBe(42);
      expect(body.data.featured).toBe(true);
      expect(body.data.category).toBe('news');
      expect(body.slug).toBe('first-entry');
      expect(body.status).toBe('DRAFT');
      expect(body.publishedAt).toBeNull();
    });

    it('rejects missing required field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            summary: 'No title provided',
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid number value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: 'Bad Number',
            count: 'not-a-number',
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid select value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: 'Bad Category',
            category: 'invalid-category',
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('creates an entry with RICHTEXT data', async () => {
      const cookie = await getSessionCookie();
      const proseMirrorDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      };

      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: `Richtext Entry ${Date.now()}`,
            content: proseMirrorDoc,
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as EntryResponse;
      expect(body.data.content).toEqual(proseMirrorDoc);
    });

    it('rejects non-object RICHTEXT value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: `Bad Richtext ${Date.now()}`,
            content: 'this is a string not an object',
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('populates entryTitle column from the ENTRY_TITLE field value on create', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<{ id: string; entryTitle: string }>(
        '/api/content-entries',
        {
          method: 'POST',
          body: {
            contentTypeId: testContentType.id,
            data: { title: 'Hello entryTitle', summary: 'x' },
            status: 'DRAFT',
          },
          headers: { cookie },
        }
      );
      expect(created.entryTitle).toBe('Hello entryTitle');
    });

    it('rejects duplicate entryTitle within a content type with 409', async () => {
      const cookie = await getSessionCookie();
      await $fetch('/api/content-entries', {
        method: 'POST',
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Unique Title', summary: 'x' },
          status: 'DRAFT',
        },
        headers: { cookie },
      });

      await expect(
        $fetch('/api/content-entries', {
          method: 'POST',
          body: {
            contentTypeId: testContentType.id,
            data: { title: 'Unique Title', summary: 'x' },
            status: 'DRAFT',
          },
          headers: { cookie },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('updates entryTitle column when title field changes via PUT', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Original', summary: 'x' },
          status: 'DRAFT',
        },
        headers: { cookie },
      });
      const updated = await $fetch<{ entryTitle: string }>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          body: { data: { title: 'Renamed', summary: 'x' } },
          headers: { cookie },
        }
      );
      expect(updated.entryTitle).toBe('Renamed');
    });

    it('enforces slug uniqueness within content type', async () => {
      const cookie = await getSessionCookie();

      // Create first entry with a specific slug
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'Unique Slug Entry',
            slug: 'unique-slug-test',
          },
        },
      });

      // Try to create another entry with the same slug
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: {
            title: 'Duplicate Slug Entry',
            slug: 'unique-slug-test',
          },
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/content-entries', () => {
    it('lists entries with contentTypeId', async () => {
      const { items, total } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.contentTypeId === testContentType.id)).toBe(
        true
      );
    });

    it('requires contentTypeId (400)', async () => {
      const res = await fetch('/api/content-entries', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(400);
    });

    it('filters by status', async () => {
      // Create a published entry
      const cookie = await getSessionCookie();
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'Published Entry',
            slug: 'published-entry',
          },
          status: 'PUBLISHED',
        },
      });

      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}&status=PUBLISHED`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });
  });

  describe('GET /api/content-entries/:id', () => {
    it('returns entry with contentType and fields', async () => {
      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      const entry = await $fetch<EntryResponse>(
        `/api/content-entries/${items[0]!.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(entry.id).toBe(items[0]!.id);
      expect(entry.data).toBeDefined();
      expect(entry.contentType).toBeDefined();
      expect(entry.contentType!.fields).toBeDefined();
      expect(entry.contentType!.fields.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for unknown id', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/content-entries/:id', () => {
    it('updates data and status', async () => {
      const cookie = await getSessionCookie();

      // Create an entry to update
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'To Update',
            slug: 'to-update',
            summary: 'Original summary',
          },
        },
      });

      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: {
              title: 'Updated Title',
              slug: 'to-update',
              summary: 'Updated summary',
              count: 10,
            },
          },
        }
      );

      expect(updated.data.title).toBe('Updated Title');
      expect(updated.data.summary).toBe('Updated summary');
      expect(updated.data.count).toBe(10);
    });

    it('sets publishedAt on first PUBLISHED', async () => {
      const cookie = await getSessionCookie();

      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'Will Publish',
            slug: 'will-publish',
          },
        },
      });
      expect(created.publishedAt).toBeNull();

      const published = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { status: 'PUBLISHED' },
        }
      );
      expect(published.status).toBe('PUBLISHED');
      expect(published.publishedAt).not.toBeNull();
    });
  });

  let relationContentType: ContentTypeResponse;
  let targetEntry: EntryResponse;

  beforeAll(async () => {
    const cookie = await getSessionCookie();

    const targetType = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Relation Target ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });

    const entryRes = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: targetType.id,
        data: { title: 'Target Entry' },
      }),
    });
    targetEntry = (await entryRes.json()) as EntryResponse;

    relationContentType = await $fetch<ContentTypeResponse>(
      '/api/content-types',
      {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Relation Test ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [targetType.id] },
            },
            {
              identifier: 'relatedItems',
              name: 'Related Items',
              type: 'MULTIRELATION',
              options: { targetContentTypeIds: [targetType.id] },
            },
          ],
        },
      }
    );
  });

  describe('RELATION/MULTIRELATION entries', () => {
    it('creates an entry with a valid RELATION value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Rel Entry ${Date.now()}`,
            link: {
              contentTypeId: targetEntry.contentTypeId,
              entryId: targetEntry.id,
            },
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as EntryResponse;
      expect(body.data.link).toEqual({
        contentTypeId: targetEntry.contentTypeId,
        entryId: targetEntry.id,
      });
    });

    it('creates an entry with a valid MULTIRELATION value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Multi Rel ${Date.now()}`,
            relatedItems: [
              {
                contentTypeId: targetEntry.contentTypeId,
                entryId: targetEntry.id,
              },
            ],
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as EntryResponse;
      expect(body.data.relatedItems).toEqual([
        {
          contentTypeId: targetEntry.contentTypeId,
          entryId: targetEntry.id,
        },
      ]);
    });

    it('accepts null RELATION value for non-required field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `No Link ${Date.now()}`,
          },
        }),
      });
      expect(res.status).toBe(201);
    });

    it('accepts empty array for MULTIRELATION', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Empty Multi ${Date.now()}`,
            relatedItems: [],
          },
        }),
      });
      expect(res.status).toBe(201);
    });

    it('rejects RELATION with non-existent entryId', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Bad Link ${Date.now()}`,
            link: {
              contentTypeId: targetEntry.contentTypeId,
              entryId: '00000000-0000-0000-0000-000000000000',
            },
          },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects RELATION with disallowed contentTypeId', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Wrong Type ${Date.now()}`,
            link: {
              contentTypeId: '00000000-0000-0000-0000-000000000000',
              entryId: targetEntry.id,
            },
          },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects MULTIRELATION with duplicate entryIds', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Dup Multi ${Date.now()}`,
            relatedItems: [
              {
                contentTypeId: targetEntry.contentTypeId,
                entryId: targetEntry.id,
              },
              {
                contentTypeId: targetEntry.contentTypeId,
                entryId: targetEntry.id,
              },
            ],
          },
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/content-entries/:id', () => {
    it('deletes an entry', async () => {
      const cookie = await getSessionCookie();

      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'To Delete',
            slug: 'to-delete',
          },
        },
      });

      const res = await fetch(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await fetch(`/api/content-entries/${created.id}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(getRes.status).toBe(404);
    });
  });
});
