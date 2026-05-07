import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';

const prismaUrl = 'postgresql://boject:boject@localhost:5432/boject_test';
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

async function ensureBlogContentType(): Promise<{ id: string }> {
  const existing = await prisma.contentType.findUnique({
    where: { identifier: 'WebhookBlog' },
  });
  if (existing) return existing;
  return prisma.contentType.create({
    data: {
      identifier: 'WebhookBlog',
      name: 'Webhook Blog',
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            order: 0,
            required: true,
            unique: true,
          },
        ],
      },
    },
  });
}

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

  describe('POST /api/content-entries — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      // The seeded test key has both content:read and content:write (T3).
      // Use a distinct X-Forwarded-For so this test gets its own rate-limit
      // bucket — the in-memory store lives in the dev-server process and
      // is not cleared by `resetRateLimitStore()` (which only clears the
      // test-process copy).
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.20',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: `API-key-created entry ${Date.now()}` },
        }),
      });
      expect(res.status).toBe(201);
    });

    it('rejects API keys without content:write scope', async () => {
      // Mint an inline key with content:read only.
      const rawKey = `boject_test_readonly_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 11);
      await prisma.apiKey.create({
        data: {
          name: 'Readonly test key',
          keyHash,
          keyPrefix,
          scopes: ['content:read'],
        },
      });
      try {
        const res = await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.21',
          },
          body: JSON.stringify({
            contentTypeId: testContentType.id,
            data: { title: `Readonly attempt ${Date.now()}` },
          }),
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('PUT /api/content-entries/[id] — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      // Create an entry via session auth first
      const cookie = await getSessionCookie();
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.22',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Update target' },
        }),
      });
      const created = (await create.json()) as { id: string };

      // Update via API key with content:write. Publish so the API-key
      // response (which can only see PUBLISHED versions) has a version
      // to return — otherwise the handler 404s after saving the draft.
      const res = await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.22',
        },
        body: JSON.stringify({
          data: { title: 'Updated by API key' },
          status: 'PUBLISHED',
        }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.23',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Readonly update target' },
        }),
      });
      const created = (await create.json()) as { id: string };

      const rawKey = `boject_test_readonly_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 11);
      await prisma.apiKey.create({
        data: {
          name: 'Readonly test key',
          keyHash,
          keyPrefix,
          scopes: ['content:read'],
        },
      });
      try {
        const res = await fetch(`/api/content-entries/${created.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.23',
          },
          body: JSON.stringify({ data: { title: 'Should be rejected' } }),
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('DELETE /api/content-entries/[id] — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.24',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Delete target (allowed)' },
        }),
      });
      const created = (await create.json()) as { id: string };

      const res = await fetch(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'X-Forwarded-For': '203.0.113.24',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.25',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Delete target (rejected)' },
        }),
      });
      const created = (await create.json()) as { id: string };

      const rawKey = `boject_test_readonly_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 11);
      await prisma.apiKey.create({
        data: {
          name: 'Readonly test key',
          keyHash,
          keyPrefix,
          scopes: ['content:read'],
        },
      });
      try {
        const res = await fetch(`/api/content-entries/${created.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.25',
          },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('DELETE /api/content-entries/[id]/draft — content:write scope (#172)', () => {
    // Helper: create entry, publish it, then make a CHANGED draft.
    // discardDraft requires a PUBLISHED fallback to exist.
    async function createWithDraft(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Discard target' },
        }),
      });
      const created = (await create.json()) as { id: string };
      // Publish
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title: 'Discard target' },
          status: 'PUBLISHED',
        }),
      });
      // Update (creates a CHANGED draft)
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ data: { title: 'Edited' } }),
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createWithDraft('203.0.113.26');
      const res = await fetch(`/api/content-entries/${id}/draft`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'X-Forwarded-For': '203.0.113.26',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const id = await createWithDraft('203.0.113.27');
      const rawKey = `boject_test_readonly_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 11);
      await prisma.apiKey.create({
        data: {
          name: 'Readonly test key',
          keyHash,
          keyPrefix,
          scopes: ['content:read'],
        },
      });
      try {
        const res = await fetch(`/api/content-entries/${id}/draft`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.27',
          },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        await prisma.apiKey.delete({ where: { keyHash } });
        // Clean up the PUBLISHED+CHANGED entry so it doesn't pollute the
        // "filters by status=PUBLISHED" test in the GET describe below.
        await prisma.contentEntry.delete({ where: { id } });
      }
    });
  });

  describe('GET /api/content-entries', () => {
    it('lists entries with contentTypeId (session sees all)', async () => {
      const cookie = await getSessionCookie();
      const { items, total } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { cookie },
        }
      );
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.contentTypeId === testContentType.id)).toBe(
        true
      );
    });

    it('API key only sees entries with PUBLISHED versions', async () => {
      const cookie = await getSessionCookie();

      // Create a published entry to ensure at least one is visible
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: `API Key Visible ${Date.now()}`,
            slug: `api-key-visible-${Date.now()}`,
          },
          status: 'PUBLISHED',
        },
      });

      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
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
            title: `Published Entry ${Date.now()}`,
            slug: `published-entry-${Date.now()}`,
          },
          status: 'PUBLISHED',
        },
      });

      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}&status=PUBLISHED`,
        {
          headers: { cookie },
        }
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });
  });

  describe('GET /api/content-entries/:id', () => {
    it('returns entry with contentType and fields (session)', async () => {
      const cookie = await getSessionCookie();
      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { cookie },
        }
      );
      const entry = await $fetch<EntryResponse>(
        `/api/content-entries/${items[0]!.id}`,
        {
          headers: { cookie },
        }
      );
      expect(entry.id).toBe(items[0]!.id);
      expect(entry.data).toBeDefined();
      expect(entry.contentType).toBeDefined();
      expect(entry.contentType!.fields).toBeDefined();
      expect(entry.contentType!.fields.length).toBeGreaterThanOrEqual(1);
    });

    it('API key returns 404 for draft-only entry', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Draft Only ${Date.now()}` },
        },
      });
      expect(created.status).toBe('DRAFT');

      const res = await fetch(`/api/content-entries/${created.id}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).toBe(404);
    });

    it('API key returns published entry', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Published For API ${Date.now()}` },
          status: 'PUBLISHED',
        },
      });

      const entry = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(entry.id).toBe(created.id);
      expect(entry.status).toBe('PUBLISHED');
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

  describe('IMAGE field end-to-end', () => {
    const sampleImage = {
      storageKey: 'e2e-test.webp',
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      fileSize: 50000,
      originalName: 'e2e.jpg',
      focalPointX: 0.25,
      focalPointY: 0.75,
    };

    let imageTypeId: string;
    let entryId: string;

    it('creates a content type with an IMAGE field', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `HasImage_${Date.now()}`,
          description: null,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
            {
              identifier: 'hero',
              name: 'Hero',
              type: 'IMAGE',
              required: false,
              order: 1,
            },
          ],
        },
      });

      expect(created.fields.some((f) => f.type === 'IMAGE')).toBe(true);
      imageTypeId = created.id;
    });

    it('creates an entry with an IMAGE value', async () => {
      const cookie = await getSessionCookie();
      const entry = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: imageTypeId,
          data: {
            title: 'IMAGE field test entry',
            hero: sampleImage,
          },
          status: 'DRAFT',
        },
      });
      expect(entry.data.hero).toEqual(sampleImage);
      entryId = entry.id;
    });

    it('reads the entry back with the IMAGE value intact', async () => {
      const cookie = await getSessionCookie();
      const entry = await $fetch<EntryResponse>(
        `/api/content-entries/${entryId}`,
        { headers: { cookie } }
      );
      expect(entry.data.hero).toEqual(sampleImage);
    });

    it('updates the IMAGE value to a new object', async () => {
      const cookie = await getSessionCookie();
      const nextImage = { ...sampleImage, storageKey: 'next.webp' };
      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${entryId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: { title: 'IMAGE field test entry', hero: nextImage },
          },
        }
      );
      expect(updated.data.hero).toEqual(nextImage);
    });

    it('clears the IMAGE value with null', async () => {
      const cookie = await getSessionCookie();
      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${entryId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: { title: 'IMAGE field test entry', hero: null },
          },
        }
      );
      expect(updated.data.hero).toBeNull();
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

      // Verify it's gone (use session — draft entries aren't visible to API key anyway)
      const getRes = await fetch(`/api/content-entries/${created.id}`, {
        headers: { Cookie: cookie },
      });
      expect(getRes.status).toBe(404);
    });
  });

  describe('Versioning', () => {
    it('save draft on a published entry creates a CHANGED version', async () => {
      const cookie = await getSessionCookie();

      // Create and publish an entry
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: `Version Test ${Date.now()}`,
            summary: 'Original',
          },
          status: 'PUBLISHED',
        },
      });
      expect(created.status).toBe('PUBLISHED');

      // Save a draft edit (no status: 'PUBLISHED' in body)
      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: {
              title: `Version Test ${Date.now()}`,
              summary: 'Edited draft',
            },
          },
        }
      );

      // CMS session sees the draft version with CHANGED status
      expect(updated.status).toBe('CHANGED');
      expect(updated.data.summary).toBe('Edited draft');
    });

    it('publish promotes CHANGED version to PUBLISHED', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();

      // Create and publish
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Promote Test ${ts}`, summary: 'Original' },
          status: 'PUBLISHED',
        },
      });

      // Save a draft edit to create a CHANGED version
      await $fetch<EntryResponse>(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: { title: `Promote Test ${ts}`, summary: 'Changed content' },
        },
      });

      // Publish the CHANGED version
      const published = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { status: 'PUBLISHED' },
        }
      );

      expect(published.status).toBe('PUBLISHED');
      expect(published.data.summary).toBe('Changed content');

      // API key should now see the updated content
      const apiView = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(apiView.status).toBe('PUBLISHED');
      expect(apiView.data.summary).toBe('Changed content');
    });

    it('CMS session includes hasPublishedVersion flag', async () => {
      const cookie = await getSessionCookie();

      // DRAFT-only entry
      const draft = await $fetch<
        EntryResponse & { hasPublishedVersion?: boolean }
      >('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `HasPub Flag ${Date.now()}` },
        },
      });

      // Fetch via session — should have hasPublishedVersion in response
      const fetched = await $fetch<
        EntryResponse & { hasPublishedVersion?: boolean }
      >(`/api/content-entries/${draft.id}`, { headers: { cookie } });
      expect(fetched.hasPublishedVersion).toBe(false);

      // Publish it
      await $fetch(`/api/content-entries/${draft.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: { status: 'PUBLISHED' },
      });

      const fetchedPublished = await $fetch<
        EntryResponse & { hasPublishedVersion?: boolean }
      >(`/api/content-entries/${draft.id}`, { headers: { cookie } });
      expect(fetchedPublished.hasPublishedVersion).toBe(true);
    });

    it('exposes publishedVersionPublishedAt to CMS across draft/published/changed', async () => {
      const cookie = await getSessionCookie();

      type WithMeta = EntryResponse & {
        hasPublishedVersion?: boolean;
        publishedVersionPublishedAt?: string | null;
      };

      // DRAFT-only: no published version yet
      const draft = await $fetch<WithMeta>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `PubTS Draft ${Date.now()}` },
        },
      });
      expect(draft.publishedVersionPublishedAt).toBeNull();

      // Publish it
      const published = await $fetch<WithMeta>(
        `/api/content-entries/${draft.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { status: 'PUBLISHED' },
        }
      );
      expect(published.publishedVersionPublishedAt).not.toBeNull();
      const originalPublishedAt = published.publishedVersionPublishedAt;

      // Save a draft edit on top of published -> CHANGED — timestamp should
      // still reflect the existing published version.
      const changed = await $fetch<WithMeta>(
        `/api/content-entries/${draft.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: {
              title: `PubTS Draft ${Date.now()}`,
              summary: 'Changed content',
            },
          },
        }
      );
      expect(changed.status).toBe('CHANGED');
      expect(changed.publishedVersionPublishedAt).toBe(originalPublishedAt);
    });

    it('hides publishedVersionPublishedAt from API key responses', async () => {
      const cookie = await getSessionCookie();

      const entry = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `PubTS ApiKey ${Date.now()}` },
          status: 'PUBLISHED',
        },
      });

      const apiView = await $fetch<
        EntryResponse & { publishedVersionPublishedAt?: string | null }
      >(`/api/content-entries/${entry.id}`, {
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(apiView.publishedVersionPublishedAt).toBeUndefined();
    });

    it('draft entries are invisible to API key in list', async () => {
      const cookie = await getSessionCookie();

      // Create a draft-only entry
      const draftEntry = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Draft Invisible ${Date.now()}` },
        },
      });

      // API key list should not include this draft entry
      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      const found = items.find((i) => i.id === draftEntry.id);
      expect(found).toBeUndefined();
    });
  });

  describe('DELETE /api/content-entries/:id/draft', () => {
    it('discards CHANGED version and returns published', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();

      // Create and publish
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Discard Draft ${ts}`, summary: 'Published content' },
          status: 'PUBLISHED',
        },
      });

      // Save a draft edit to create CHANGED version
      await $fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: {
            title: `Discard Draft ${ts}`,
            summary: 'Draft changes to discard',
          },
        },
      });

      // Verify CMS sees CHANGED
      const changed = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        { headers: { cookie } }
      );
      expect(changed.status).toBe('CHANGED');

      // Discard the draft
      const discarded = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}/draft`,
        {
          method: 'DELETE',
          headers: { Cookie: cookie },
        }
      );

      // Should return the published version
      expect(discarded.status).toBe('PUBLISHED');
      expect(discarded.data.summary).toBe('Published content');
    });

    it('returns 404 when no draft version exists', async () => {
      const cookie = await getSessionCookie();

      // Create a published-only entry (no draft)
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `No Draft ${Date.now()}` },
          status: 'PUBLISHED',
        },
      });

      const res = await fetch(`/api/content-entries/${created.id}/draft`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when discarding the only version', async () => {
      const cookie = await getSessionCookie();

      // Create a draft-only entry
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Only Version ${Date.now()}` },
        },
      });
      expect(created.status).toBe('DRAFT');

      const res = await fetch(`/api/content-entries/${created.id}/draft`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('unique field enforcement', () => {
    async function createUniqueContentType(
      cookie: string,
      suffix: string,
      fieldType: 'TEXT' | 'NUMBER' = 'TEXT',
      fieldIdentifier = 'sku'
    ): Promise<ContentTypeResponse> {
      return await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Unique ${fieldType} ${suffix}`,
          description: 'Content type for unique enforcement tests',
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: fieldIdentifier,
              name: fieldIdentifier.toUpperCase(),
              type: fieldType,
              unique: true,
            },
          ],
        },
      });
    }

    it('rejects creating an entry with a duplicate unique TEXT value', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `text-${ts}`);

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `First ${ts}`, sku: 'SKU-1' },
        },
      });

      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Second ${ts}`, sku: 'SKU-1' },
        }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects creating an entry with a duplicate unique NUMBER value', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(
        cookie,
        `number-${ts}`,
        'NUMBER',
        'issue'
      );

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `First ${ts}`, issue: 7 },
        },
      });

      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Second ${ts}`, issue: 7 },
        }),
      });
      expect(res.status).toBe(409);
    });

    it('allows multiple entries with empty/null unique values', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `empty-${ts}`);

      const first = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Empty 1 ${ts}`, sku: '' },
        },
      });
      const second = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Empty 2 ${ts}`, sku: null },
        },
      });
      const third = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Empty 3 ${ts}` },
        },
      });

      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();
      expect(third.id).toBeTruthy();
    });

    it('allows an entry to keep its own unique value on update', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `self-${ts}`);

      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Self ${ts}`, sku: 'SKU-ABC' },
        },
      });

      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: { title: `Self Renamed ${ts}`, sku: 'SKU-ABC' },
          },
        }
      );
      expect(updated.id).toBe(created.id);
      expect((updated.data as Record<string, unknown>).sku).toBe('SKU-ABC');
    });

    it('blocks conflicts across all versions (draft vs draft)', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `draft-${ts}`);

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Draft A ${ts}`, sku: 'SKU-DRAFT' },
          status: 'DRAFT',
        },
      });

      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Draft B ${ts}`, sku: 'SKU-DRAFT' },
          status: 'DRAFT',
        }),
      });
      expect(res.status).toBe(409);
    });

    it('returns 409 body shape with UNIQUE_CONFLICT error and offending value', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `shape-${ts}`);

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Shape A ${ts}`, sku: 'SHAPE-1' },
        },
      });

      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Shape B ${ts}`, sku: 'SHAPE-1' },
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        data?: { error?: string; field?: string; value?: unknown };
        error?: string;
        field?: string;
        value?: unknown;
      };
      const payload = body.data ?? body;
      expect(payload.error).toBe('UNIQUE_CONFLICT');
      expect(payload.field).toBe('sku');
      expect(payload.value).toBe('SHAPE-1');
    });
  });

  describe('Webhook ENTRY_PUBLISHED wiring', () => {
    it('inserts a WebhookDelivery row when a matching webhook is enabled', async () => {
      const cookie = await getSessionCookie();

      const hook = await prisma.webhook.create({
        data: {
          name: `Publish hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const createRes = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Hook target ${Date.now()}` },
        }),
      });
      const created = (await createRes.json()) as {
        id: string;
        data: { title: string };
      };

      const publishRes = await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });
      expect(publishRes.status).toBe(200);

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(
        deliveries.some(
          (d) => d.event === 'ENTRY_PUBLISHED' && d.entryId === created.id
        )
      ).toBe(true);

      const match = deliveries.find(
        (d) => d.event === 'ENTRY_PUBLISHED' && d.entryId === created.id
      );
      expect(match).toBeDefined();
      expect(match!.status).toBe('PENDING');

      const payload = match!.payload as {
        event: string;
        entry: {
          status: string;
          data: { title: string };
          publishedAt: string | null;
        };
      };
      expect(payload.event).toBe('ENTRY_PUBLISHED');
      expect(payload.entry.status).toBe('PUBLISHED');
      expect(payload.entry.data.title).toBe(created.data.title);
      expect(payload.entry.publishedAt).not.toBeNull();
    });

    it('does not enqueue when the content-type filter excludes this entry type', async () => {
      const cookie = await getSessionCookie();
      const ct = await ensureBlogContentType();

      // Create a second content type that the webhook will allow. Publishing a
      // WebhookBlog entry should NOT enqueue.
      const otherCt = await prisma.contentType.upsert({
        where: { identifier: 'WebhookOther' },
        update: {},
        create: {
          identifier: 'WebhookOther',
          name: 'Webhook Other',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });

      const hook = await prisma.webhook.create({
        data: {
          name: `CT-filter hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [otherCt.id],
        },
      });

      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `CT filter test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(deliveries.length).toBe(0);
    });

    it('does not enqueue when the webhook event filter excludes the event', async () => {
      const cookie = await getSessionCookie();

      const hook = await prisma.webhook.create({
        data: {
          name: `Delete-only hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_DELETED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Filter test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(deliveries.length).toBe(0);
    });

    it('does not enqueue when the webhook is disabled', async () => {
      const cookie = await getSessionCookie();

      const hook = await prisma.webhook.create({
        data: {
          name: `Disabled hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: false,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Disabled test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(deliveries.length).toBe(0);
    });
  });

  describe('Webhook ENTRY_DELETED wiring', () => {
    it('enqueues ENTRY_DELETED when a published entry is deleted', async () => {
      const cookie = await getSessionCookie();
      // Use a distinct X-Forwarded-For so this test gets its own rate-limit
      // bucket — otherwise the cumulative POST/PUT/DELETE mutations across
      // the file can exceed the 50-per-60s cap by the time this test runs.
      const ip = { 'X-Forwarded-For': '203.0.113.10' };

      const hook = await prisma.webhook.create({
        data: {
          name: `Delete hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_DELETED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            ...ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Delete target ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const delRes = await fetch(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie, ...ip },
      });
      expect(delRes.status).toBe(200);

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      const match = deliveries.find(
        (d) => d.event === 'ENTRY_DELETED' && d.entryId === created.id
      );
      expect(match).toBeDefined();
      expect(match!.status).toBe('PENDING');

      const payload = match!.payload as {
        event: string;
        entry: { status: string; data: { title: string } };
      };
      expect(payload.event).toBe('ENTRY_DELETED');
      expect(payload.entry.status).toBe('PUBLISHED');
      expect(payload.entry.data.title).toBe(created.data.title);
    });

    it('does not enqueue when deleting a draft-only entry', async () => {
      const cookie = await getSessionCookie();
      const ip = { 'X-Forwarded-For': '203.0.113.11' };

      const hook = await prisma.webhook.create({
        data: {
          name: `Delete-draft hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_DELETED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            ...ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Draft only ${Date.now()}` },
          }),
        })
      ).json()) as { id: string };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie, ...ip },
      });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(deliveries.length).toBe(0);
    });
  });

  describe('POST /api/content-entries/[id]/unpublish', () => {
    it('demotes a PUBLISHED entry to DRAFT and enqueues ENTRY_UNPUBLISHED', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.20';

      const hook = await prisma.webhook.create({
        data: {
          name: `Unpub hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_UNPUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Unpub target ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('DRAFT');

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      const match = deliveries.find(
        (d) => d.event === 'ENTRY_UNPUBLISHED' && d.entryId === created.id
      );
      expect(match).toBeDefined();
      const payload = match!.payload as {
        event: string;
        entry: { status: string; data: { title: string } };
      };
      expect(payload.event).toBe('ENTRY_UNPUBLISHED');
      expect(payload.entry.status).toBe('PUBLISHED');
      expect(payload.entry.data.title).toBe(created.data.title);
    });

    it('collapses CHANGED into DRAFT when both PUBLISHED and CHANGED exist', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.21';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Unpub-C ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });
      // Save a CHANGED draft with different text
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title: `${created.data.title} — edited` },
        }),
      });

      const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        data: { title: string };
      };
      expect(body.status).toBe('DRAFT');
      expect(body.data.title).toBe(`${created.data.title} — edited`);
    });

    it('returns 409 when entry has no PUBLISHED version', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.22';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Unpub-fail ${Date.now()}` },
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('WRONG_STATE');
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000/unpublish',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            'X-Forwarded-For': '203.0.113.23',
          },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/content-entries/[id]/archive', () => {
    it('flips PUBLISHED → ARCHIVED and enqueues ENTRY_UNPUBLISHED', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.30';

      const hook = await prisma.webhook.create({
        data: {
          name: `Arc hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_UNPUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Arc target ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const res = await fetch(`/api/content-entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ARCHIVED');

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      const match = deliveries.find(
        (d) => d.event === 'ENTRY_UNPUBLISHED' && d.entryId === created.id
      );
      expect(match).toBeDefined();
      const payload = match!.payload as {
        event: string;
        entry: { status: string; data: { title: string } };
      };
      expect(payload.event).toBe('ENTRY_UNPUBLISHED');
      expect(payload.entry.status).toBe('PUBLISHED');
      expect(payload.entry.data.title).toBe(created.data.title);
    });

    it('preserves publishedAt on the ARCHIVED row', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.31';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Arc-preserve ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      // Capture publishedAt before archive
      const pub = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: 'PUBLISHED' },
      });
      expect(pub.publishedAt).not.toBeNull();

      await fetch(`/api/content-entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const archived = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: 'ARCHIVED' },
      });
      expect(archived.publishedAt?.toISOString()).toBe(
        pub.publishedAt!.toISOString()
      );
    });

    it('returns 409 DRAFT_PRESENT when a CHANGED draft exists', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.32';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Arc-C ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title: `${created.data.title} draft` },
        }),
      });

      const res = await fetch(`/api/content-entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('DRAFT_PRESENT');
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000/archive',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            'X-Forwarded-For': '203.0.113.33',
          },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/content-entries/[id]/unarchive', () => {
    it('flips ARCHIVED → DRAFT and does not enqueue a webhook delivery', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.40';

      const hook = await prisma.webhook.create({
        data: {
          name: `No unarchive hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Unarc ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });
      await fetch(`/api/content-entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const beforeCount = await prisma.webhookDelivery.count({
        where: { webhookId: hook.id },
      });

      const res = await fetch(`/api/content-entries/${created.id}/unarchive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('DRAFT');

      const afterCount = await prisma.webhookDelivery.count({
        where: { webhookId: hook.id },
      });
      expect(afterCount).toBe(beforeCount);
    });

    it('returns 409 when entry has no ARCHIVED version', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.41';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Unarc-fail ${Date.now()}` },
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/content-entries/${created.id}/unarchive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('WRONG_STATE');
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000/unarchive',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            'X-Forwarded-For': '203.0.113.42',
          },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/content-entries/[id]/republish', () => {
    it('enqueues ENTRY_PUBLISHED without mutating the entry', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.50';

      const hook = await prisma.webhook.create({
        data: {
          name: `Repub hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Repub ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });

      const beforeCount = await prisma.webhookDelivery.count({
        where: {
          webhookId: hook.id,
          event: 'ENTRY_PUBLISHED',
          entryId: created.id,
        },
      });

      // Capture the published version's id before republish
      const pubBefore = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: 'PUBLISHED' },
      });

      const res = await fetch(`/api/content-entries/${created.id}/republish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('PUBLISHED');

      // Same PUBLISHED row still exists with the same id — no mutation
      const pubAfter = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: 'PUBLISHED' },
      });
      expect(pubAfter.id).toBe(pubBefore.id);
      expect(pubAfter.publishedAt?.toISOString()).toBe(
        pubBefore.publishedAt!.toISOString()
      );

      // Webhook delivery count incremented by exactly 1
      const afterCount = await prisma.webhookDelivery.count({
        where: {
          webhookId: hook.id,
          event: 'ENTRY_PUBLISHED',
          entryId: created.id,
        },
      });
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('returns 409 NOT_PUBLISHED when entry has no PUBLISHED version', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.51';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Repub-fail ${Date.now()}` },
          }),
        })
      ).json()) as { id: string };

      const res = await fetch(`/api/content-entries/${created.id}/republish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('NOT_PUBLISHED');
    });

    it('is unaffected by a CHANGED draft', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.52';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Repub-CH ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
      });
      await fetch(`/api/content-entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ data: { title: `${created.data.title} dr` } }),
      });

      const res = await fetch(`/api/content-entries/${created.id}/republish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('PUBLISHED');
    });

    it('rejects API-key callers', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000/republish',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            'X-Forwarded-For': '203.0.113.53',
          },
        }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/content-entries archiveFilter', () => {
    it('excludes archived entries by default (archiveFilter=active)', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.60';
      const ct = await ensureBlogContentType();

      const live = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Live ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/content-entries/${live.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: live.data }),
      });

      const archived = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Arc ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/content-entries/${archived.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: archived.data }),
      });
      await fetch(`/api/content-entries/${archived.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const defaultList = (await (
        await fetch(`/api/content-entries?contentTypeId=${ct.id}`, {
          headers: { Cookie: cookie, 'X-Forwarded-For': ip },
        })
      ).json()) as { items: Array<{ id: string }> };
      expect(defaultList.items.some((i) => i.id === archived.id)).toBe(false);
      expect(defaultList.items.some((i) => i.id === live.id)).toBe(true);

      const archivedList = (await (
        await fetch(
          `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=archived`,
          { headers: { Cookie: cookie, 'X-Forwarded-For': ip } }
        )
      ).json()) as { items: Array<{ id: string; status: string }> };
      expect(archivedList.items.some((i) => i.id === archived.id)).toBe(true);
      expect(archivedList.items.some((i) => i.id === live.id)).toBe(false);
      expect(archivedList.items.every((i) => i.status === 'ARCHIVED')).toBe(
        true
      );

      const allList = (await (
        await fetch(
          `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=all`,
          { headers: { Cookie: cookie, 'X-Forwarded-For': ip } }
        )
      ).json()) as { items: Array<{ id: string }> };
      expect(allList.items.some((i) => i.id === archived.id)).toBe(true);
      expect(allList.items.some((i) => i.id === live.id)).toBe(true);
    });
  });

  describe('Relation picker archive exclusion', () => {
    it('archived entries do not appear in the picker list (archiveFilter=active)', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.61';
      const ct = await ensureBlogContentType();

      const target = (await (
        await fetch('/api/content-entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Picker target ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };
      await fetch(`/api/content-entries/${target.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ status: 'PUBLISHED', data: target.data }),
      });
      await fetch(`/api/content-entries/${target.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const res = await fetch(
        `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=active`,
        { headers: { Cookie: cookie, 'X-Forwarded-For': ip } }
      );
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === target.id)).toBe(false);
    });
  });

  describe('RICHTEXT inline embeds', () => {
    let targetCt: { id: string };
    let otherCt: { id: string };
    let hostCt: { id: string };
    let targetEntryId: string;
    let otherEntryId: string;

    beforeAll(async () => {
      targetCt = await prisma.contentType.create({
        data: {
          identifier: 'EmbedNote',
          name: 'EmbedNote',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });
      otherCt = await prisma.contentType.create({
        data: {
          identifier: 'EmbedOther',
          name: 'EmbedOther',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });
      hostCt = await prisma.contentType.create({
        data: {
          identifier: 'EmbedHost',
          name: 'EmbedHost',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                order: 0,
                required: true,
                unique: true,
              },
              {
                identifier: 'body',
                name: 'Body',
                type: 'RICHTEXT',
                order: 1,
                required: false,
                unique: false,
                options: { targetContentTypeIds: [targetCt.id] },
              },
            ],
          },
        },
      });

      const targetEntry = await prisma.contentEntry.create({
        data: {
          contentTypeId: targetCt.id,
          entryTitle: 'EmbedTarget',
          slug: null,
          versions: {
            create: {
              status: 'DRAFT',
              entryTitle: 'EmbedTarget',
              data: { title: 'EmbedTarget' },
            },
          },
        },
      });
      targetEntryId = targetEntry.id;

      const otherEntry = await prisma.contentEntry.create({
        data: {
          contentTypeId: otherCt.id,
          entryTitle: 'EmbedOtherEntry',
          slug: null,
          versions: {
            create: {
              status: 'DRAFT',
              entryTitle: 'EmbedOtherEntry',
              data: { title: 'EmbedOtherEntry' },
            },
          },
        },
      });
      otherEntryId = otherEntry.id;
    });

    it('accepts a body with an embed whose contentTypeId is in the allow-list', async () => {
      const cookie = await getSessionCookie();
      // Use a distinct X-Forwarded-For so this test gets its own rate-limit
      // bucket — the cumulative POST mutations across the file can exceed the
      // 50-per-60s cap by the time these tests run.
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.50',
        },
        body: JSON.stringify({
          contentTypeId: hostCt.id,
          data: {
            title: 'HostAllowed',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'see ' },
                    {
                      type: 'cmsEmbed',
                      attrs: {
                        contentTypeId: targetCt.id,
                        entryId: targetEntryId,
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      });
      expect(res.status).toBe(201);
    });

    it('rejects an embed whose contentTypeId is not in the allow-list', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.51',
        },
        body: JSON.stringify({
          contentTypeId: hostCt.id,
          data: {
            title: 'HostDisallowed',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'cmsEmbed',
                      attrs: {
                        contentTypeId: otherCt.id,
                        entryId: otherEntryId,
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('persists contentTypeIdentifier on cmsEmbed.attrs when saving', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.52';
      const create = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: hostCt.id,
          data: {
            title: 'HostStamped',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'cmsEmbed',
                      attrs: {
                        contentTypeId: targetCt.id,
                        entryId: targetEntryId,
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as {
        id: string;
        data: { body: unknown };
      };

      // Verify the persisted body carries the identifier
      const get = await fetch(`/api/content-entries/${created.id}`, {
        headers: { cookie, 'X-Forwarded-For': ip },
      });
      const fetched = (await get.json()) as {
        data: { body: { content: unknown[] } };
      };
      const para = fetched.data.body.content[0] as { content: unknown[] };
      const embed = para.content[0] as { attrs: Record<string, unknown> };
      expect(embed.attrs).toEqual({
        contentTypeId: targetCt.id,
        entryId: targetEntryId,
        contentTypeIdentifier: 'EmbedNote',
      });
    });
  });

  describe('Auth middleware — /api/content-entries (#172)', () => {
    it('allows API keys past the middleware (no longer 403 read-only)', async () => {
      // After #172 Task 2, /api/content-entries is in API_KEY_WRITABLE_PATHS.
      // Without the per-handler scope check (added in T4), the request reaches
      // the handler and gets whatever response the handler produces. Without a
      // body, that's a 400 for missing contentTypeId. Anything other than the
      // middleware's 403 'API keys have read-only access' is acceptable here.
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(403);
      if (res.status === 403) {
        const body = (await res.json()) as { message?: string };
        // Belt-and-braces: even if Vitest somehow accepted the not-403, this
        // would surface a misdiagnosis early.
        expect(body.message).not.toMatch(/read-only/i);
      }
    });
  });
});
