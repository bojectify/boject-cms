import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { getTestDatabaseUrl } from '../../../test/dbUrl';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

const prismaUrl = getTestDatabaseUrl();
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

async function ensureBlogContentType(): Promise<{
  id: string;
  identifier: string;
}> {
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
            type: FIELD_TYPES.ENTRY_TITLE,
            order: 0,
            required: true,
            unique: true,
          },
        ],
      },
    },
  });
}

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

type KeysetPageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};
type KeysetListResponse = { items: EntryResponse[]; pageInfo: KeysetPageInfo };

let testContentType: ContentTypeResponse;

/**
 * Rate-limit isolation: this file uses IPs from TEST-NET-3
 * (`203.0.113.0/24`, reserved by RFC 5737 for documentation /
 * test use) in the `X-Forwarded-For` header. The mutation rate
 * limiter (`enforceMutationRateLimit`) keys per-IP per-endpoint,
 * so each test that touches a rate-limited path needs a unique
 * IP to avoid bucket collisions with neighbours.
 *
 * Current allocations:
 *
 *   .10-.19   webhook ENTRY_DELETED wiring (Webhook describe block)
 *   .20-.29   content:write scope tests (#172 family) — POST, PUT,
 *             DELETE, draft.DELETE, archive
 *   .30-.39   content:write scope tests — unarchive, unpublish,
 *             republish; ALSO pre-existing archive lifecycle tests
 *             at .30-.32 (collision; tolerated because the scope
 *             tests use distinct keys and the pre-existing tests
 *             use session auth which short-circuits the scope check
 *             before the rate limiter charges)
 *   .40-.49   pre-existing unarchive lifecycle tests
 *   .50-.59   pre-existing republish lifecycle tests
 *   .60-.69   archiveFilter tests
 *   .70-.79   field default values tests (#344)
 *   .80-.89   keyset pagination (#265) — the brief's .20-.29 was
 *             already taken by the #172 family, so this block
 *             claims the next free /10 range per the protocol below
 *   .180-.199 ad-hoc / one-off IPs (currently: .99, .183,
 *             .184-.186 entryKey derivation tests (#205),
 *             .187-.188 entryKey immutability tests (#205),
 *             .189-.190 entryKey in REST responses tests (#205),
 *             .191-.192 publish-on-create webhook enqueue tests (#330),
 *             .193-.195 ENTRY_DRAFT_SYNC enqueue tests (#302))
 *
 * When adding a new rate-limited test:
 *  1. Find the describe block your test will live in
 *  2. Use the next unused IP in that block's range
 *  3. If your block isn't listed above, claim the next free range
 *     (in /10-increments) and update this legend
 */
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
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: FIELD_TYPES.SLUG },
          { identifier: 'summary', name: 'Summary', type: FIELD_TYPES.TEXT },
          { identifier: 'count', name: 'Count', type: FIELD_TYPES.NUMBER },
          {
            identifier: 'featured',
            name: 'Featured',
            type: FIELD_TYPES.BOOLEAN,
          },
          {
            identifier: 'publishDate',
            name: 'Publish Date',
            type: FIELD_TYPES.DATETIME,
          },
          {
            identifier: 'category',
            name: 'Category',
            type: FIELD_TYPES.SELECT,
            options: { choices: ['news', 'blog', 'update'] },
          },
          {
            identifier: 'content',
            name: 'Content',
            type: FIELD_TYPES.RICHTEXT,
          },
        ],
      },
    });
  });

  describe('POST /api/entries', () => {
    it('creates an entry with valid data', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
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
      expect(body.status).toBe(CONTENT_STATUSES.DRAFT);
      expect(body.publishedAt).toBeNull();
    });

    it('rejects missing required field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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

      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
        '/api/entries',
        {
          method: 'POST',
          body: {
            contentTypeId: testContentType.id,
            data: { title: 'Hello entryTitle', summary: 'x' },
            status: CONTENT_STATUSES.DRAFT,
          },
          headers: { cookie },
        }
      );
      expect(created.entryTitle).toBe('Hello entryTitle');
    });

    it('rejects duplicate entryTitle within a content type with 409', async () => {
      const cookie = await getSessionCookie();
      await $fetch('/api/entries', {
        method: 'POST',
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Unique Title', summary: 'x' },
          status: CONTENT_STATUSES.DRAFT,
        },
        headers: { cookie },
      });

      await expect(
        $fetch('/api/entries', {
          method: 'POST',
          body: {
            contentTypeId: testContentType.id,
            data: { title: 'Unique Title', summary: 'x' },
            status: CONTENT_STATUSES.DRAFT,
          },
          headers: { cookie },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('updates entryTitle column when title field changes via PUT', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<{ id: string }>('/api/entries', {
        method: 'POST',
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Original', summary: 'x' },
          status: CONTENT_STATUSES.DRAFT,
        },
        headers: { cookie },
      });
      const updated = await $fetch<{ entryTitle: string }>(
        `/api/entries/${created.id}`,
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
      await $fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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

  describe('entryKey derivation on create (#205)', () => {
    // Distinct X-Forwarded-For per test isolates the mutation rate-limit
    // bucket from the rest of the suite (see IP allocation legend).
    it('derives entryKey from slugify(entryTitle) and returns it', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const title = `Hello World ${suffix}`;
      const expectedKey = `hello-world-${suffix}`;
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.184',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as EntryResponse & {
        entryKey: string;
      };
      expect(created.entryKey).toBe(expectedKey);
    });

    it('returns 409 ENTRY_KEY_CONFLICT when two titles slugify identically', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const firstTitle = `Hero Banner ${suffix}`;
      const secondTitle = `Hero - Banner ${suffix}`;
      const expectedKey = `hero-banner-${suffix}`;

      const first = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.185',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: firstTitle },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(first.status).toBe(201);

      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.185',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: secondTitle },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });

      expect(res.status).toBe(409);
      const payload = (await res.json()) as {
        data?: {
          error: string;
          entryKey: string;
          conflictingEntryTitle: string;
        };
      };
      expect(payload.data?.error).toBe('ENTRY_KEY_CONFLICT');
      expect(payload.data?.entryKey).toBe(expectedKey);
      expect(payload.data?.conflictingEntryTitle).toBe(firstTitle);
    });

    it('returns 400 ENTRY_KEY_EMPTY when entryTitle has no slug-safe chars', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.186',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: '!!!' },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });

      expect(res.status).toBe(400);
      const payload = (await res.json()) as { data?: { error: string } };
      expect(payload.data?.error).toBe('ENTRY_KEY_EMPTY');
    });
  });

  describe('entryKey is immutable after create (#205)', () => {
    it('does not change when entryTitle is renamed via PUT', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const originalTitle = `Original Title ${suffix}`;
      const renamedTitle = `Renamed Title ${suffix}`;
      const expectedKey = `original-title-${suffix}`;

      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.187',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: originalTitle },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as EntryResponse & {
        entryKey: string;
      };
      expect(created.entryKey).toBe(expectedKey);

      const putRes = await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.187',
        },
        body: JSON.stringify({
          data: { title: renamedTitle },
        }),
      });
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as EntryResponse & {
        entryKey: string;
        entryTitle: string;
      };
      expect(updated.entryTitle).toBe(renamedTitle);
      expect(updated.data.title).toBe(renamedTitle);
      // entryKey must remain the original slugify(originalTitle) value
      expect(updated.entryKey).toBe(expectedKey);

      // Defence-in-depth: confirm the persisted envelope row also has the
      // original key — the response shape is built via flattenEntryWithVersion
      // so this catches any future flatten-helper regression too.
      const dbRow = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: created.id },
        select: { entryKey: true, entryTitle: true },
      });
      expect(dbRow.entryKey).toBe(expectedKey);
      expect(dbRow.entryTitle).toBe(renamedTitle);
    });

    it('is preserved through archive then unarchive', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const title = `Lifecycle Target ${suffix}`;
      const expectedKey = `lifecycle-target-${suffix}`;

      // Create entry as DRAFT then publish so archive is legal.
      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.188',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as EntryResponse & {
        entryKey: string;
      };
      expect(created.entryKey).toBe(expectedKey);

      const publishRes = await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.188',
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: { title },
        }),
      });
      expect(publishRes.status).toBe(200);

      const archiveRes = await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.188' },
      });
      expect(archiveRes.status).toBe(200);

      const unarchiveRes = await fetch(`/api/entries/${created.id}/unarchive`, {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.188' },
      });
      expect(unarchiveRes.status).toBe(200);

      const getRes = await fetch(`/api/entries/${created.id}`, {
        headers: { cookie, 'X-Forwarded-For': '203.0.113.188' },
      });
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as EntryResponse & {
        entryKey: string;
      };
      expect(fetched.entryKey).toBe(expectedKey);

      // Defence-in-depth: confirm DB row directly.
      const dbRow = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: created.id },
        select: { entryKey: true },
      });
      expect(dbRow.entryKey).toBe(expectedKey);
    });
  });

  describe('entryKey in REST responses (#205)', () => {
    it('GET /api/entries/:id includes entryKey', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const title = `Detail View ${suffix}`;
      const expectedKey = `detail-view-${suffix}`;

      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.189',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };

      const getRes = await fetch(`/api/entries/${created.id}`, {
        headers: { cookie, 'X-Forwarded-For': '203.0.113.189' },
      });
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as EntryResponse & {
        entryKey: string;
      };
      expect(fetched.entryKey).toBe(expectedKey);
    });

    it('GET /api/entries (list) includes entryKey on every item', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();
      const title = `List Item ${suffix}`;
      const expectedKey = `list-item-${suffix}`;

      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.190',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(createRes.status).toBe(201);

      const listRes = await fetch(
        `/api/entries?contentTypeId=${testContentType.id}&perPage=100`,
        {
          headers: { cookie, 'X-Forwarded-For': '203.0.113.190' },
        }
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as {
        items: Array<EntryResponse & { entryKey: string }>;
        total: number;
      };
      // Every item should carry entryKey
      expect(list.items.every((i) => typeof i.entryKey === 'string')).toBe(
        true
      );
      const found = list.items.find((i) => i.entryKey === expectedKey);
      expect(found).toBeDefined();
    });
  });

  describe('POST /api/entries — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      // Use a distinct X-Forwarded-For so this test gets its own rate-limit
      // bucket — the in-memory store lives in the dev-server process and
      // is not cleared by `resetRateLimitStore()` (which only clears the
      // test-process copy).
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.20',
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: `Session-created entry ${Date.now()}` },
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
        const res = await fetch('/api/entries', {
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

    it('POST /api/entries returns 403 INSUFFICIENT_SCOPE for content:read-only API keys before body validation', async () => {
      // Pins the assertApiKeyScope-before-body-validation order. The
      // @boject/cli probeContentWriteScope helper (#183) depends on
      // this ordering to distinguish "missing scope" (403) from
      // "scope OK but body invalid" (400/404). Sentinel body uses an
      // all-zero UUID that won't match any real ContentType row; if
      // the handler validated the body first, this would 404, not 403.
      //
      // Do NOT use the canonical perf key here — its scopes are
      // widened in seed.ts for the e2e flow. Mint a fresh
      // content:read-only key inline.
      const rawKey = `boject_test_probe_readonly_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 11);
      await prisma.apiKey.create({
        data: {
          name: 'Probe contract test key',
          keyHash,
          keyPrefix,
          scopes: ['content:read'],
        },
      });
      try {
        const res = await fetch('/api/entries', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.183',
          },
          body: JSON.stringify({
            contentTypeId: '00000000-0000-0000-0000-000000000000',
            data: {},
          }),
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as {
          data?: { error?: string; required?: string };
        };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
        expect(body.data?.required).toBe('content:write');
      } finally {
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('PUT /api/entries/[id] — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      // Create an entry via session auth first
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.22',
        },
        body: JSON.stringify({
          data: { title: 'Updated by session' },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
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
        const res = await fetch(`/api/entries/${created.id}`, {
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

  describe('DELETE /api/entries/[id] — content:write scope (#172)', () => {
    it('allows API keys with content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}`, {
        method: 'DELETE',
        headers: {
          cookie,
          'X-Forwarded-For': '203.0.113.24',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
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
        const res = await fetch(`/api/entries/${created.id}`, {
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

  describe('DELETE /api/entries/[id]/draft — content:write scope (#172)', () => {
    // Helper: create entry, publish it, then make a CHANGED draft.
    // discardDraft requires a PUBLISHED fallback to exist.
    async function createWithDraft(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      // Unique title per IP so the two tests in this describe don't
      // collide on the immutable entryKey unique constraint (#205).
      // Same reason 'Edited' is also IP-scoped — the CHANGED draft's
      // PUT updates the envelope entryTitle, which has its own unique
      // constraint.
      const title = `Discard target ${ip}`;
      const editedTitle = `Edited ${ip}`;
      const create = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
        }),
      });
      const created = (await create.json()) as { id: string };
      // Publish
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      // Update (creates a CHANGED draft)
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ data: { title: editedTitle } }),
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createWithDraft('203.0.113.26');
      const cookie = await getSessionCookie();
      const res = await fetch(`/api/entries/${id}/draft`, {
        method: 'DELETE',
        headers: {
          cookie,
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
        const res = await fetch(`/api/entries/${id}/draft`, {
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

  describe('POST /api/entries/[id]/archive — content:write scope (#172)', () => {
    async function createPublished(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Archive target' },
        }),
      });
      const created = (await create.json()) as { id: string };
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title: 'Archive target' },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createPublished('203.0.113.28');
      const cookie = await getSessionCookie();
      const res = await fetch(`/api/entries/${id}/archive`, {
        method: 'POST',
        headers: {
          cookie,
          'X-Forwarded-For': '203.0.113.28',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const id = await createPublished('203.0.113.29');
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
        const res = await fetch(`/api/entries/${id}/archive`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.29',
          },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        // Clean up: archived entries don't pollute the active-status default
        // filter, but the inline-minted key must be removed.
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('POST /api/entries/[id]/unarchive — content:write scope (#172)', () => {
    async function createArchived(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      const create = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Unarchive target' },
        }),
      });
      const created = (await create.json()) as { id: string };
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title: 'Unarchive target' },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: {
          cookie,
          'X-Forwarded-For': ip,
        },
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createArchived('203.0.113.30');
      const cookie = await getSessionCookie();
      const res = await fetch(`/api/entries/${id}/unarchive`, {
        method: 'POST',
        headers: {
          cookie,
          'X-Forwarded-For': '203.0.113.30',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const id = await createArchived('203.0.113.31');
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
        const res = await fetch(`/api/entries/${id}/unarchive`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.31',
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

  describe('POST /api/entries/[id]/unpublish — content:write scope (#172)', () => {
    async function createPublished(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      const title = `Unpublish target ${Date.now()}-${Math.random()}`;
      const create = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
        }),
      });
      const created = (await create.json()) as { id: string };
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createPublished('203.0.113.32');
      const cookie = await getSessionCookie();
      const res = await fetch(`/api/entries/${id}/unpublish`, {
        method: 'POST',
        headers: {
          cookie,
          'X-Forwarded-For': '203.0.113.32',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const id = await createPublished('203.0.113.33');
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
        const res = await fetch(`/api/entries/${id}/unpublish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.33',
          },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        // The rejected unpublish leaves the entry as PUBLISHED — clean it up
        // so it doesn't pollute the active-status-default-filter test counts.
        await prisma.contentEntry.delete({ where: { id } });
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('GET /api/entries', () => {
    it('lists entries with contentTypeId (session sees all)', async () => {
      const cookie = await getSessionCookie();
      const { items, pageInfo } = await $fetch<KeysetListResponse>(
        `/api/entries?contentTypeId=${testContentType.id}`,
        {
          headers: { cookie },
        }
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.contentTypeId === testContentType.id)).toBe(
        true
      );
      // Response is keyset-shaped now (#265): pageInfo, no total.
      expect(pageInfo).toBeDefined();
      expect(typeof pageInfo.hasNextPage).toBe('boolean');
    });

    it('requires contentTypeId (400)', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        headers: { cookie },
      });

      expect(res.status).toBe(400);
    });

    it('filters by status', async () => {
      // Create a published entry
      const cookie = await getSessionCookie();
      await $fetch('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: `Published Entry ${Date.now()}`,
            slug: `published-entry-${Date.now()}`,
          },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });

      const { items } = await $fetch<ListResponse>(
        `/api/entries?contentTypeId=${testContentType.id}&status=PUBLISHED`,
        {
          headers: { cookie },
        }
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === CONTENT_STATUSES.PUBLISHED)).toBe(
        true
      );
    });
  });

  describe('GET /api/entries keyset pagination (#265)', () => {
    it('paginates forward with pageInfo and no total; accepts contentType identifier', async () => {
      const cookie = await getSessionCookie();
      const ct = await ensureBlogContentType(); // identifier known via ct.identifier
      let seedIp = 80;
      const mk = async (title: string) => {
        const created = (await (
          await fetch('/api/entries', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookie,
              'X-Forwarded-For': `203.0.113.${seedIp++}`,
            },
            body: JSON.stringify({ contentTypeId: ct.id, data: { title } }),
          })
        ).json()) as { id: string };
        return created.id;
      };
      const a = await mk(`KS A ${Date.now()}`);
      const b = await mk(`KS B ${Date.now()}`);
      const c = await mk(`KS C ${Date.now()}`);
      const mine = new Set([a, b, c]);

      // Page by contentTypeId
      const p1 = (await $fetch(
        `/api/entries?contentTypeId=${ct.id}&perPage=2`,
        {
          headers: { cookie },
        }
      )) as {
        items: Array<{ id: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
      expect(p1).toHaveProperty('pageInfo');
      expect(p1).not.toHaveProperty('total');
      expect(p1.items.length).toBeLessThanOrEqual(2);
      expect(p1.pageInfo.endCursor).toBeTruthy();

      // Walk until we've seen all of mine; assert no dupes among my ids.
      const seen: string[] = p1.items.map((i) => i.id);
      let cursor = p1.pageInfo.endCursor;
      let hasNext = p1.pageInfo.hasNextPage;
      let guard = 0;
      while (hasNext && guard++ < 50) {
        const pn = (await $fetch(
          `/api/entries?contentTypeId=${ct.id}&perPage=2&after=${encodeURIComponent(cursor!)}`,
          { headers: { cookie } }
        )) as {
          items: Array<{ id: string }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
        seen.push(...pn.items.map((i) => i.id));
        cursor = pn.pageInfo.endCursor;
        hasNext = pn.pageInfo.hasNextPage;
      }
      const mineSeen = seen.filter((id) => mine.has(id));
      expect(new Set(mineSeen)).toEqual(mine); // all present
      expect(mineSeen.length).toBe(mine.size); // no dupes

      // contentType identifier resolves to the same first page as contentTypeId
      const byIdentifier = (await $fetch(
        `/api/entries?contentType=${ct.identifier}&perPage=2`,
        { headers: { cookie } }
      )) as { items: Array<{ id: string }> };
      const byUuid = (await $fetch(
        `/api/entries?contentTypeId=${ct.id}&perPage=2`,
        {
          headers: { cookie },
        }
      )) as { items: Array<{ id: string }> };
      expect(byIdentifier.items.map((i) => i.id)).toEqual(
        byUuid.items.map((i) => i.id)
      );
    });

    it('400 when neither contentType nor contentTypeId is given; 400 on bad cursor', async () => {
      const cookie = await getSessionCookie();
      const noType = await fetch('/api/entries', {
        headers: { Cookie: cookie },
      });
      expect(noType.status).toBe(400);
      const ct = await ensureBlogContentType();
      const badCursor = await fetch(
        `/api/entries?contentTypeId=${ct.id}&after=garbage`,
        { headers: { Cookie: cookie } }
      );
      expect(badCursor.status).toBe(400);
    });

    it('unknown contentType identifier returns an empty page (not 404)', async () => {
      const cookie = await getSessionCookie();
      const res = (await $fetch('/api/entries?contentType=NoSuchTypeXYZ', {
        headers: { cookie },
      })) as { items: unknown[]; pageInfo: { hasNextPage: boolean } };
      expect(res.items).toEqual([]);
      expect(res.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('GET /api/entries/:id', () => {
    it('returns entry with contentType and fields (session)', async () => {
      const cookie = await getSessionCookie();
      const { items } = await $fetch<ListResponse>(
        `/api/entries?contentTypeId=${testContentType.id}`,
        {
          headers: { cookie },
        }
      );
      const entry = await $fetch<EntryResponse>(
        `/api/entries/${items[0]!.id}`,
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

    it('returns published entry via session', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Published For Session ${Date.now()}` },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });

      const entry = await $fetch<EntryResponse>(`/api/entries/${created.id}`, {
        headers: { cookie },
      });
      expect(entry.id).toBe(created.id);
      expect(entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
    });

    it('returns 404 for unknown id', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch(
        '/api/entries/00000000-0000-0000-0000-000000000000',
        {
          headers: { cookie },
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/entries/:id', () => {
    it('updates data and status', async () => {
      const cookie = await getSessionCookie();

      // Create an entry to update
      const created = await $fetch<EntryResponse>('/api/entries', {
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
        `/api/entries/${created.id}`,
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

      const created = await $fetch<EntryResponse>('/api/entries', {
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
        `/api/entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { status: CONTENT_STATUSES.PUBLISHED },
        }
      );
      expect(published.status).toBe(CONTENT_STATUSES.PUBLISHED);
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
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
          },
        ],
      },
    });

    const entryRes = await fetch('/api/entries', {
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
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: FIELD_TYPES.RELATION,
              options: { targetContentTypeIds: [targetType.id] },
            },
            {
              identifier: 'relatedItems',
              name: 'Related Items',
              type: FIELD_TYPES.MULTIRELATION,
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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

    it('rejects RELATION with disallowed contentTypeId and surfaces the offending id', async () => {
      const cookie = await getSessionCookie();
      const offending = '11111111-1111-4111-8111-111111111111';
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: relationContentType.id,
          data: {
            title: `Wrong Type ${Date.now()}`,
            link: {
              contentTypeId: offending,
              entryId: targetEntry.id,
            },
          },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage || body.message || '';
      expect(message).toContain(`contentTypeId: ${offending}`);
    });

    it('rejects MULTIRELATION with duplicate entryIds', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
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
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
            },
            {
              identifier: 'hero',
              name: 'Hero',
              type: FIELD_TYPES.IMAGE,
              required: false,
              order: 1,
            },
          ],
        },
      });

      expect(created.fields.some((f) => f.type === FIELD_TYPES.IMAGE)).toBe(
        true
      );
      imageTypeId = created.id;
    });

    it('creates an entry with an IMAGE value', async () => {
      const cookie = await getSessionCookie();
      const entry = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: imageTypeId,
          data: {
            title: 'IMAGE field test entry',
            hero: sampleImage,
          },
          status: CONTENT_STATUSES.DRAFT,
        },
      });
      expect(entry.data.hero).toEqual(sampleImage);
      entryId = entry.id;
    });

    it('reads the entry back with the IMAGE value intact', async () => {
      const cookie = await getSessionCookie();
      const entry = await $fetch<EntryResponse>(`/api/entries/${entryId}`, {
        headers: { cookie },
      });
      expect(entry.data.hero).toEqual(sampleImage);
    });

    it('updates the IMAGE value to a new object', async () => {
      const cookie = await getSessionCookie();
      const nextImage = { ...sampleImage, storageKey: 'next.webp' };
      const updated = await $fetch<EntryResponse>(`/api/entries/${entryId}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: { title: 'IMAGE field test entry', hero: nextImage },
        },
      });
      expect(updated.data.hero).toEqual(nextImage);
    });

    it('clears the IMAGE value with null', async () => {
      const cookie = await getSessionCookie();
      const updated = await $fetch<EntryResponse>(`/api/entries/${entryId}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: { title: 'IMAGE field test entry', hero: null },
        },
      });
      expect(updated.data.hero).toBeNull();
    });
  });

  describe('DELETE /api/entries/:id', () => {
    it('deletes an entry', async () => {
      const cookie = await getSessionCookie();

      const created = await $fetch<EntryResponse>('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify it's gone (use session — draft entries aren't visible to API key anyway)
      const getRes = await fetch(`/api/entries/${created.id}`, {
        headers: { Cookie: cookie },
      });
      expect(getRes.status).toBe(404);
    });
  });

  describe('Versioning', () => {
    it('save draft on a published entry creates a CHANGED version', async () => {
      const cookie = await getSessionCookie();

      // Create and publish an entry
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: `Version Test ${Date.now()}`,
            summary: 'Original',
          },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });
      expect(created.status).toBe(CONTENT_STATUSES.PUBLISHED);

      // Save a draft edit (no status: 'PUBLISHED' in body)
      const updated = await $fetch<EntryResponse>(
        `/api/entries/${created.id}`,
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
      expect(updated.status).toBe(CONTENT_STATUSES.CHANGED);
      expect(updated.data.summary).toBe('Edited draft');
    });

    it('publish promotes CHANGED version to PUBLISHED', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();

      // Create and publish
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Promote Test ${ts}`, summary: 'Original' },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });

      // Save a draft edit to create a CHANGED version
      await $fetch<EntryResponse>(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: { title: `Promote Test ${ts}`, summary: 'Changed content' },
        },
      });

      // Publish the CHANGED version
      const published = await $fetch<EntryResponse>(
        `/api/entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { status: CONTENT_STATUSES.PUBLISHED },
        }
      );

      expect(published.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(published.data.summary).toBe('Changed content');

      // Session should now see the updated content as PUBLISHED
      const apiView = await $fetch<EntryResponse>(
        `/api/entries/${created.id}`,
        {
          headers: { cookie },
        }
      );
      expect(apiView.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(apiView.data.summary).toBe('Changed content');
    });

    it('CMS session includes hasPublishedVersion flag', async () => {
      const cookie = await getSessionCookie();

      // DRAFT-only entry
      const draft = await $fetch<
        EntryResponse & { hasPublishedVersion?: boolean }
      >('/api/entries', {
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
      >(`/api/entries/${draft.id}`, { headers: { cookie } });
      expect(fetched.hasPublishedVersion).toBe(false);

      // Publish it
      await $fetch(`/api/entries/${draft.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: { status: CONTENT_STATUSES.PUBLISHED },
      });

      const fetchedPublished = await $fetch<
        EntryResponse & { hasPublishedVersion?: boolean }
      >(`/api/entries/${draft.id}`, { headers: { cookie } });
      expect(fetchedPublished.hasPublishedVersion).toBe(true);
    });

    it('exposes publishedVersionPublishedAt to CMS across draft/published/changed', async () => {
      const cookie = await getSessionCookie();

      type WithMeta = EntryResponse & {
        hasPublishedVersion?: boolean;
        publishedVersionPublishedAt?: string | null;
      };

      // DRAFT-only: no published version yet
      const draft = await $fetch<WithMeta>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `PubTS Draft ${Date.now()}` },
        },
      });
      expect(draft.publishedVersionPublishedAt).toBeNull();

      // Publish it
      const published = await $fetch<WithMeta>(`/api/entries/${draft.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: { status: CONTENT_STATUSES.PUBLISHED },
      });
      expect(published.publishedVersionPublishedAt).not.toBeNull();
      const originalPublishedAt = published.publishedVersionPublishedAt;

      // Save a draft edit on top of published -> CHANGED — timestamp should
      // still reflect the existing published version.
      const changed = await $fetch<WithMeta>(`/api/entries/${draft.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: {
            title: `PubTS Draft ${Date.now()}`,
            summary: 'Changed content',
          },
        },
      });
      expect(changed.status).toBe(CONTENT_STATUSES.CHANGED);
      expect(changed.publishedVersionPublishedAt).toBe(originalPublishedAt);
    });
  });

  describe('DELETE /api/entries/:id/draft', () => {
    it('discards CHANGED version and returns published', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();

      // Create and publish
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Discard Draft ${ts}`, summary: 'Published content' },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });

      // Save a draft edit to create CHANGED version
      await $fetch(`/api/entries/${created.id}`, {
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
        `/api/entries/${created.id}`,
        { headers: { cookie } }
      );
      expect(changed.status).toBe(CONTENT_STATUSES.CHANGED);

      // Discard the draft
      const discarded = await $fetch<EntryResponse>(
        `/api/entries/${created.id}/draft`,
        {
          method: 'DELETE',
          headers: { Cookie: cookie },
        }
      );

      // Should return the published version
      expect(discarded.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(discarded.data.summary).toBe('Published content');
    });

    it('returns 404 when no draft version exists', async () => {
      const cookie = await getSessionCookie();

      // Create a published-only entry (no draft)
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `No Draft ${Date.now()}` },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      });

      const res = await fetch(`/api/entries/${created.id}/draft`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when discarding the only version', async () => {
      const cookie = await getSessionCookie();

      // Create a draft-only entry
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: `Only Version ${Date.now()}` },
        },
      });
      expect(created.status).toBe(CONTENT_STATUSES.DRAFT);

      const res = await fetch(`/api/entries/${created.id}/draft`, {
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
      fieldType:
        | typeof FIELD_TYPES.TEXT
        | typeof FIELD_TYPES.NUMBER = FIELD_TYPES.TEXT,
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
              type: FIELD_TYPES.ENTRY_TITLE,
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

      await $fetch('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `First ${ts}`, sku: 'SKU-1' },
        },
      });

      const res = await fetch('/api/entries', {
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
        FIELD_TYPES.NUMBER,
        'issue'
      );

      await $fetch('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `First ${ts}`, issue: 7 },
        },
      });

      const res = await fetch('/api/entries', {
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

      const first = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Empty 1 ${ts}`, sku: '' },
        },
      });
      const second = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Empty 2 ${ts}`, sku: null },
        },
      });
      const third = await $fetch<EntryResponse>('/api/entries', {
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

      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Self ${ts}`, sku: 'SKU-ABC' },
        },
      });

      const updated = await $fetch<EntryResponse>(
        `/api/entries/${created.id}`,
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

      await $fetch('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Draft A ${ts}`, sku: 'SKU-DRAFT' },
          status: CONTENT_STATUSES.DRAFT,
        },
      });

      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Draft B ${ts}`, sku: 'SKU-DRAFT' },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(res.status).toBe(409);
    });

    it('returns 409 body shape with UNIQUE_CONFLICT error and offending value', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();
      const ct = await createUniqueContentType(cookie, `shape-${ts}`);

      await $fetch('/api/entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Shape A ${ts}`, sku: 'SHAPE-1' },
        },
      });

      const res = await fetch('/api/entries', {
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
      const createRes = await fetch('/api/entries', {
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

      const publishRes = await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
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
      expect(payload.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(payload.entry.data.title).toBe(created.data.title);
      expect(payload.entry.publishedAt).not.toBeNull();
    });

    it('inserts a WebhookDelivery row when a new entry is published on create (#330)', async () => {
      const cookie = await getSessionCookie();

      const hook = await prisma.webhook.create({
        data: {
          name: `Publish-on-create hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      const title = `Create-publish target ${Date.now()}`;
      // Distinct X-Forwarded-For so this test gets its own rate-limit bucket
      // (see IP allocation legend) — the in-memory store lives in the
      // dev-server process and is not cleared by `resetRateLimitStore()`
      // (which only clears the test-process copy), so the default-IP bucket
      // accumulates across the file.
      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': '203.0.113.191',
        },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        id: string;
        data: { title: string };
        status: string;
      };
      expect(created.status).toBe(CONTENT_STATUSES.PUBLISHED);

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
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
      expect(payload.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(payload.entry.data.title).toBe(title);
      expect(payload.entry.publishedAt).not.toBeNull();
    });

    it('does not enqueue when a new entry is created as a DRAFT (#330)', async () => {
      const cookie = await getSessionCookie();

      const hook = await prisma.webhook.create({
        data: {
          name: `Draft-on-create hook ${Date.now()}`,
          url: 'https://example.com/hook',
          secret: 'test-secret',
          enabled: true,
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        },
      });

      const ct = await ensureBlogContentType();
      // Distinct X-Forwarded-For for an isolated rate-limit bucket (see legend).
      const createRes = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': '203.0.113.192',
        },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Draft-on-create target ${Date.now()}` },
          status: CONTENT_STATUSES.DRAFT,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id, entryId: created.id },
      });
      expect(deliveries.length).toBe(0);
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
                type: FIELD_TYPES.ENTRY_TITLE,
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
        await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `CT filter test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
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
        await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Filter test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
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
        await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            contentTypeId: ct.id,
            data: { title: `Disabled test ${Date.now()}` },
          }),
        })
      ).json()) as { id: string; data: { title: string } };

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });

      const delRes = await fetch(`/api/entries/${created.id}`, {
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
      expect(payload.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie, ...ip },
      });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
      });
      expect(deliveries.length).toBe(0);
    });
  });

  describe('POST /api/entries/[id]/unpublish', () => {
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });

      const res = await fetch(`/api/entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(CONTENT_STATUSES.DRAFT);

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
      expect(payload.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(payload.entry.data.title).toBe(created.data.title);
    });

    it('collapses CHANGED into DRAFT when both PUBLISHED and CHANGED exist', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.21';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });
      // Save a CHANGED draft with different text
      await fetch(`/api/entries/${created.id}`, {
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

      const res = await fetch(`/api/entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        data: { title: string };
      };
      expect(body.status).toBe(CONTENT_STATUSES.DRAFT);
      expect(body.data.title).toBe(`${created.data.title} — edited`);
    });

    it('returns 409 when entry has no PUBLISHED version', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.22';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}/unpublish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('WRONG_STATE');
    });
  });

  describe('POST /api/entries/[id]/archive', () => {
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });

      const res = await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(CONTENT_STATUSES.ARCHIVED);

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
      expect(payload.entry.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(payload.entry.data.title).toBe(created.data.title);
    });

    it('preserves publishedAt on the ARCHIVED row', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.31';
      const ct = await ensureBlogContentType();
      const created = (await (
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });

      // Capture publishedAt before archive
      const pub = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: CONTENT_STATUSES.PUBLISHED },
      });
      expect(pub.publishedAt).not.toBeNull();

      await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const archived = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: CONTENT_STATUSES.ARCHIVED },
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });
      await fetch(`/api/entries/${created.id}`, {
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

      const res = await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('DRAFT_PRESENT');
    });
  });

  describe('POST /api/entries/[id]/unarchive', () => {
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
        await fetch('/api/entries', {
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
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });
      await fetch(`/api/entries/${created.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const beforeCount = await prisma.webhookDelivery.count({
        where: { webhookId: hook.id },
      });

      const res = await fetch(`/api/entries/${created.id}/unarchive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(CONTENT_STATUSES.DRAFT);

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
        await fetch('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}/unarchive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('WRONG_STATE');
    });
  });

  describe('POST /api/entries/[id]/republish', () => {
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
        await fetch('/api/entries', {
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
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
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
        where: { entryId: created.id, status: CONTENT_STATUSES.PUBLISHED },
      });

      const res = await fetch(`/api/entries/${created.id}/republish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(CONTENT_STATUSES.PUBLISHED);

      // Same PUBLISHED row still exists with the same id — no mutation
      const pubAfter = await prisma.contentEntryVersion.findFirstOrThrow({
        where: { entryId: created.id, status: CONTENT_STATUSES.PUBLISHED },
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
        await fetch('/api/entries', {
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

      const res = await fetch(`/api/entries/${created.id}/republish`, {
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
        await fetch('/api/entries', {
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

      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: created.data,
        }),
      });
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ data: { title: `${created.data.title} dr` } }),
      });

      const res = await fetch(`/api/entries/${created.id}/republish`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(CONTENT_STATUSES.PUBLISHED);
    });
  });

  describe('POST /api/entries/[id]/republish — content:write scope (#172)', () => {
    async function createPublished(ip: string): Promise<string> {
      const cookie = await getSessionCookie();
      const title = `Republish target ${Date.now()}-${Math.random()}`;
      const create = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title },
        }),
      });
      const created = (await create.json()) as { id: string };
      await fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          data: { title },
          status: CONTENT_STATUSES.PUBLISHED,
        }),
      });
      return created.id;
    }

    it('allows API keys with content:write scope', async () => {
      const id = await createPublished('203.0.113.34');
      const cookie = await getSessionCookie();
      const res = await fetch(`/api/entries/${id}/republish`, {
        method: 'POST',
        headers: {
          cookie,
          'X-Forwarded-For': '203.0.113.34',
        },
      });
      expect(res.status).toBe(200);
    });

    it('rejects API keys without content:write scope', async () => {
      const id = await createPublished('203.0.113.35');
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
        const res = await fetch(`/api/entries/${id}/republish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'X-Forwarded-For': '203.0.113.35',
          },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { data?: { error?: string } };
        expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      } finally {
        // The rejected republish leaves the entry as PUBLISHED — clean up
        // so it doesn't pollute downstream active-status-default-filter tests.
        await prisma.contentEntry.delete({ where: { id } });
        await prisma.apiKey.delete({ where: { keyHash } });
      }
    });
  });

  describe('GET /api/entries archiveFilter', () => {
    it('excludes archived entries by default (archiveFilter=active)', async () => {
      const cookie = await getSessionCookie();
      const ip = '203.0.113.60';
      const ct = await ensureBlogContentType();

      const live = (await (
        await fetch('/api/entries', {
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
      await fetch(`/api/entries/${live.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: live.data,
        }),
      });

      const archived = (await (
        await fetch('/api/entries', {
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
      await fetch(`/api/entries/${archived.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: archived.data,
        }),
      });
      await fetch(`/api/entries/${archived.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const defaultList = (await (
        await fetch(`/api/entries?contentTypeId=${ct.id}`, {
          headers: { Cookie: cookie, 'X-Forwarded-For': ip },
        })
      ).json()) as { items: Array<{ id: string }> };
      expect(defaultList.items.some((i) => i.id === archived.id)).toBe(false);
      expect(defaultList.items.some((i) => i.id === live.id)).toBe(true);

      const archivedList = (await (
        await fetch(
          `/api/entries?contentTypeId=${ct.id}&archiveFilter=archived`,
          { headers: { Cookie: cookie, 'X-Forwarded-For': ip } }
        )
      ).json()) as { items: Array<{ id: string; status: string }> };
      expect(archivedList.items.some((i) => i.id === archived.id)).toBe(true);
      expect(archivedList.items.some((i) => i.id === live.id)).toBe(false);
      expect(
        archivedList.items.every((i) => i.status === CONTENT_STATUSES.ARCHIVED)
      ).toBe(true);

      const allList = (await (
        await fetch(`/api/entries?contentTypeId=${ct.id}&archiveFilter=all`, {
          headers: { Cookie: cookie, 'X-Forwarded-For': ip },
        })
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
        await fetch('/api/entries', {
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
      await fetch(`/api/entries/${target.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({
          status: CONTENT_STATUSES.PUBLISHED,
          data: target.data,
        }),
      });
      await fetch(`/api/entries/${target.id}/archive`, {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Forwarded-For': ip },
      });

      const res = await fetch(
        `/api/entries?contentTypeId=${ct.id}&archiveFilter=active`,
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
                type: FIELD_TYPES.ENTRY_TITLE,
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
                type: FIELD_TYPES.ENTRY_TITLE,
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
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
              {
                identifier: 'body',
                name: 'Body',
                type: FIELD_TYPES.RICHTEXT,
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
          entryKey: 'embedtarget',
          slug: null,
          versions: {
            create: {
              status: CONTENT_STATUSES.DRAFT,
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
          entryKey: 'embedotherentry',
          slug: null,
          versions: {
            create: {
              status: CONTENT_STATUSES.DRAFT,
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
      const res = await fetch('/api/entries', {
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
      const res = await fetch('/api/entries', {
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
      const create = await fetch('/api/entries', {
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
      const get = await fetch(`/api/entries/${created.id}`, {
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

  describe('Auth middleware — /api/entries (#172)', () => {
    it('session auth reaches handler (400 for empty body, not 403)', async () => {
      // The handler requires a contentTypeId; without it the body is rejected
      // with 400. Anything other than 403 confirms auth was accepted.
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(403);
    });
  });

  describe('POST /api/entries — rate limit fires (#172)', () => {
    it('returns 429 from rate limiter under rapid requests', async () => {
      // The rate limiter is 50/60s per IP per endpoint. 60 rapid requests
      // should trip it (rate limiting is IP-based, not auth-based).
      // Use a unique IP so this test doesn't collide with other tests'
      // rate-limit windows.
      const cookie = await getSessionCookie();
      const ip = '203.0.113.99';
      const responses: number[] = [];
      for (let i = 0; i < 60; i++) {
        const res = await fetch('/api/entries', {
          method: 'POST',
          headers: {
            cookie,
            'Content-Type': 'application/json',
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({
            contentTypeId: testContentType.id,
            data: { title: `Rate limit test ${Date.now()}-${i}` },
          }),
        });
        responses.push(res.status);
      }
      expect(responses).toContain(429);
    }, 30_000);
  });

  describe('GET /api/entries — single-version fetch (#264)', () => {
    it('returns draft-priority version + flatten keys with many ARCHIVED versions', async () => {
      const cookie = await getSessionCookie();

      const ct = await prisma.contentType.create({
        data: {
          identifier: `SingleVersion264_${Date.now()}`,
          name: `Single Version 264 ${Date.now()}`,
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
            ],
          },
        },
      });

      const archivedTitles = Array.from(
        { length: 25 },
        (_, i) => `Archived payload ${i}`
      );

      const entry = await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'Published title',
          entryKey: 'single-version-264',
          slug: null,
          versions: {
            create: [
              {
                status: CONTENT_STATUSES.PUBLISHED,
                entryTitle: 'Published title',
                data: { title: 'Published title' },
                publishedAt: new Date(),
              },
              {
                status: CONTENT_STATUSES.CHANGED,
                entryTitle: 'Changed title',
                data: { title: 'Changed title' },
              },
              ...archivedTitles.map((title) => ({
                status: CONTENT_STATUSES.ARCHIVED,
                entryTitle: title,
                data: { title },
              })),
            ],
          },
        },
      });

      // archiveFilter=all: this entry has ARCHIVED versions, so the default
      // `active` filter excludes the whole envelope (`versions: { none:
      // ARCHIVED }`). `all` keeps it visible and exercises draft-priority
      // (CHANGED) version resolution against the multi-version row.
      const defaultRes = await fetch(
        `/api/entries?contentTypeId=${ct.id}&archiveFilter=all`,
        { headers: { Cookie: cookie } }
      );
      const defaultBody = (await defaultRes.json()) as {
        items: Array<Record<string, unknown>>;
      };
      const item = defaultBody.items.find((i) => i.id === entry.id);
      expect(item).toBeDefined();
      expect(item!.status).toBe(CONTENT_STATUSES.CHANGED);
      expect(item!.data).toEqual({ title: 'Changed title' });
      // flattenEntryWithVersion key surface.
      for (const key of [
        'id',
        'contentTypeId',
        'data',
        'entryTitle',
        'entryKey',
        'slug',
        'status',
        'publishedAt',
        'createdBy',
        'updatedBy',
        'createdAt',
        'updatedAt',
      ]) {
        expect(item).toHaveProperty(key);
      }

      // archiveFilter=archived: returns an ARCHIVED version whose data is one
      // of the seeded archived payloads. The specific version is the latest by
      // updatedAt, which can't be controlled deterministically on create, so we
      // only assert status + membership in the archived set.
      const archivedRes = await fetch(
        `/api/entries?contentTypeId=${ct.id}&archiveFilter=archived`,
        { headers: { Cookie: cookie } }
      );
      const archivedBody = (await archivedRes.json()) as {
        items: Array<{ id: string; status: string; data: { title: string } }>;
      };
      const archivedItem = archivedBody.items.find((i) => i.id === entry.id);
      expect(archivedItem).toBeDefined();
      expect(archivedItem!.status).toBe(CONTENT_STATUSES.ARCHIVED);
      expect(archivedTitles).toContain(archivedItem!.data.title);
    });
  });

  describe('ENTRY_DRAFT_SYNC enqueue (#302)', () => {
    // Rate-limit IPs: 203.0.113.193-.195 (see the legend at the top of the file).
    let draftSyncCookie: string;
    const auth = (ip: string) => ({
      cookie: draftSyncCookie,
      'x-forwarded-for': ip,
    });
    let draftSyncWebhookId: string;

    beforeAll(async () => {
      draftSyncCookie = await getSessionCookie();
      // External webhooks can't subscribe to the internal-only ENTRY_DRAFT_SYNC,
      // so create the subscriber directly. Scope delivery counts to its id so the
      // assertions are deterministic even if a plugin seeded another internal row.
      const wh = await prisma.webhook.create({
        data: {
          name: `test-draft-sync-${Date.now()}`,
          kind: 'INTERNAL',
          url: null,
          secret: null,
          enabled: true,
          contentTypeIds: [],
          events: ['ENTRY_DRAFT_SYNC'],
        },
      });
      draftSyncWebhookId = wh.id;
    });

    afterAll(async () => {
      // Cascades its deliveries.
      await prisma.webhook.delete({ where: { id: draftSyncWebhookId } });
    });

    async function makeType(identifier: string) {
      return prisma.contentType.create({
        data: {
          identifier,
          name: identifier,
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
              },
            ],
          },
        },
      });
    }
    const draftSyncCount = (entryId: string) =>
      prisma.webhookDelivery.count({
        where: {
          event: 'ENTRY_DRAFT_SYNC',
          entryId,
          webhookId: draftSyncWebhookId,
        },
      });

    it('a new DRAFT entry enqueues ENTRY_DRAFT_SYNC; publish-on-create does not', async () => {
      const ct = await makeType(`DraftSyncA_${Date.now()}`);
      const draft = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: auth('203.0.113.193'),
        body: { contentTypeId: ct.id, data: { title: `Draft ${Date.now()}` } },
      });
      expect(await draftSyncCount(draft.id)).toBe(1);

      const pub = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: auth('203.0.113.193'),
        body: {
          contentTypeId: ct.id,
          status: 'PUBLISHED',
          data: { title: `Pub ${Date.now()}` },
        },
      });
      expect(await draftSyncCount(pub.id)).toBe(0);
      expect(
        await prisma.webhookDelivery.count({
          where: { event: 'ENTRY_PUBLISHED', entryId: pub.id },
        })
      ).toBeGreaterThanOrEqual(1);
    });

    it('discarding a CHANGED draft enqueues ENTRY_DRAFT_SYNC', async () => {
      const ct = await makeType(`DraftSyncB_${Date.now()}`);
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: auth('203.0.113.194'),
        body: {
          contentTypeId: ct.id,
          status: 'PUBLISHED',
          data: { title: `HasDraft ${Date.now()}` },
        },
      });
      // Save a CHANGED draft (this PUT also enqueues one ENTRY_DRAFT_SYNC).
      await $fetch(`/api/entries/${created.id}`, {
        method: 'PUT',
        headers: auth('203.0.113.194'),
        body: { data: { title: `HasDraft edited ${Date.now()}` } },
      });
      const before = await draftSyncCount(created.id);
      expect(before).toBe(1);
      // Discard it → one more ENTRY_DRAFT_SYNC.
      await $fetch(`/api/entries/${created.id}/draft`, {
        method: 'DELETE',
        headers: auth('203.0.113.194'),
      });
      expect(await draftSyncCount(created.id)).toBe(before + 1);
    });

    it('unarchive and draft-only delete each enqueue ENTRY_DRAFT_SYNC', async () => {
      const ct = await makeType(`DraftSyncC_${Date.now()}`);

      // Unarchive: publish → archive (fires ENTRY_UNPUBLISHED, not draft-sync) →
      // unarchive (ARCHIVED→DRAFT) fires the draft trigger.
      const pub = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: auth('203.0.113.195'),
        body: {
          contentTypeId: ct.id,
          status: 'PUBLISHED',
          data: { title: `Arch ${Date.now()}` },
        },
      });
      await $fetch(`/api/entries/${pub.id}/archive`, {
        method: 'POST',
        headers: auth('203.0.113.195'),
      });
      const beforeUnarchive = await draftSyncCount(pub.id);
      await $fetch(`/api/entries/${pub.id}/unarchive`, {
        method: 'POST',
        headers: auth('203.0.113.195'),
      });
      expect(await draftSyncCount(pub.id)).toBe(beforeUnarchive + 1);

      // Draft-only delete: a never-published entry's delete fires the draft
      // trigger (ENTRY_DELETED only fires when a published version existed).
      const draft = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: auth('203.0.113.195'),
        body: {
          contentTypeId: ct.id,
          data: { title: `DelDraft ${Date.now()}` },
        },
      });
      const beforeDelete = await draftSyncCount(draft.id); // 1 from the create
      await $fetch(`/api/entries/${draft.id}`, {
        method: 'DELETE',
        headers: auth('203.0.113.195'),
      });
      expect(await draftSyncCount(draft.id)).toBe(beforeDelete + 1);
    });
  });

  describe('field columns (#303 browse-mode parity)', () => {
    it('projects ?columns= to a `fields` map identical to /api/search (DATETIME→epoch, RELATION→{entryId,entryTitle})', async () => {
      const cookie = await getSessionCookie();
      const suffix = Date.now();

      // A content type that relates to itself, so the same type carries both the
      // RELATION column and the target entry. Built via direct prisma (the #264 /
      // #302 blocks' convention) for a deterministic, isolated row set.
      const ct = await prisma.contentType.create({
        data: {
          identifier: `FieldColumns303_${suffix}`,
          name: `Field Columns 303 ${suffix}`,
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
              {
                identifier: 'name',
                name: 'Name',
                type: FIELD_TYPES.TEXT,
                order: 1,
              },
              {
                identifier: 'publishDate',
                name: 'Publish Date',
                type: FIELD_TYPES.DATETIME,
                order: 2,
              },
              {
                identifier: 'author',
                name: 'Author',
                type: FIELD_TYPES.RELATION,
                order: 3,
              },
            ],
          },
        },
      });

      const target = await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'Acme Corp',
          entryKey: `acme-corp-${suffix}`,
          slug: null,
          versions: {
            create: [
              {
                status: CONTENT_STATUSES.DRAFT,
                entryTitle: 'Acme Corp',
                data: { title: 'Acme Corp' },
              },
            ],
          },
        },
      });

      const isoPublished = '2023-11-14T22:13:20.000Z';
      const main = await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'Main',
          entryKey: `main-${suffix}`,
          slug: null,
          versions: {
            create: [
              {
                status: CONTENT_STATUSES.DRAFT,
                entryTitle: 'Main',
                data: {
                  title: 'Main',
                  name: 'Widget',
                  publishDate: isoPublished,
                  author: { contentTypeId: ct.id, entryId: target.id },
                },
              },
            ],
          },
        },
      });

      const res = await fetch(
        `/api/entries?contentTypeId=${ct.id}&columns=name,publishDate,author`,
        { headers: { cookie } }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<Record<string, unknown> & { id: string }>;
      };
      const item = body.items.find((i) => i.id === main.id);
      expect(item).toBeDefined();
      expect(item!.fields).toEqual({
        name: 'Widget',
        publishDate: Date.parse(isoPublished),
        author: { entryId: target.id, entryTitle: 'Acme Corp' },
      });

      // No `columns` requested → no `fields` key (browse callers unaffected).
      const plainRes = await fetch(`/api/entries?contentTypeId=${ct.id}`, {
        headers: { cookie },
      });
      expect(plainRes.status).toBe(200);
      const plain = (await plainRes.json()) as {
        items: Array<Record<string, unknown> & { id: string }>;
      };
      const plainItem = plain.items.find((i) => i.id === main.id);
      expect(plainItem).toBeDefined();
      expect(plainItem).not.toHaveProperty('fields');
    });
  });

  describe('field default values (#344)', () => {
    // Direct-prisma content-type create (the #264 / #302 / #303 convention) so
    // the `options.default` JSON is persisted verbatim, independent of whether
    // the content-type API persists the `default` key. Defaults are configured
    // on a BOOLEAN, a required NUMBER, and a SELECT field.
    let defaultsCtId: string;

    beforeAll(async () => {
      const suffix = Date.now();
      const ct = await prisma.contentType.create({
        data: {
          identifier: `FieldDefaults344_${suffix}`,
          name: `Field Defaults 344 ${suffix}`,
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                order: 0,
                required: true,
                unique: true,
              },
              {
                identifier: 'flag',
                name: 'Flag',
                type: FIELD_TYPES.BOOLEAN,
                order: 1,
                options: { default: false },
              },
              {
                identifier: 'qty',
                name: 'Qty',
                type: FIELD_TYPES.NUMBER,
                order: 2,
                required: true,
                options: { default: 0 },
              },
              {
                identifier: 'state',
                name: 'State',
                type: FIELD_TYPES.SELECT,
                order: 3,
                options: { choices: ['draft', 'live'], default: 'draft' },
              },
            ],
          },
        },
      });
      defaultsCtId = ct.id;
    });

    afterAll(async () => {
      // Entries (and their cascade-deleted versions) must go before the type —
      // the content_type FK on ContentEntry blocks deleting a referenced type.
      await prisma.contentEntry.deleteMany({
        where: { contentTypeId: defaultsCtId },
      });
      await prisma.contentType.delete({ where: { id: defaultsCtId } });
    });

    it('seeds BOOLEAN/NUMBER/SELECT defaults for absent fields on create', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.70' },
        body: {
          contentTypeId: defaultsCtId,
          data: { title: `Defaults A ${Date.now()}` },
        },
      });
      expect(created.data.flag).toBe(false);
      expect(created.data.qty).toBe(0);
      expect(created.data.state).toBe('draft');
    });

    it('a NUMBER default satisfies a required field omitted from the payload', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.71',
        },
        body: JSON.stringify({
          contentTypeId: defaultsCtId,
          data: { title: `Defaults B ${Date.now()}` },
        }),
      });
      // `qty` is required but omitted — its default `0` satisfies required.
      expect(res.status).toBe(201);
    });

    it('rejects an explicit null on a required field (explicit clear is respected)', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.72',
        },
        body: JSON.stringify({
          contentTypeId: defaultsCtId,
          data: { title: `Defaults C ${Date.now()}`, qty: null },
        }),
      });
      // Explicit null is not absent, so the default does not fill it and the
      // required check fails.
      expect(res.status).toBe(400);
    });

    it('explicit values override defaults on create', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.73' },
        body: {
          contentTypeId: defaultsCtId,
          data: {
            title: `Defaults D ${Date.now()}`,
            flag: true,
            qty: 5,
            state: 'live',
          },
        },
      });
      expect(created.data.flag).toBe(true);
      expect(created.data.qty).toBe(5);
      expect(created.data.state).toBe('live');
    });

    it('does NOT apply defaults on update (PUT)', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/entries', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.74' },
        body: {
          contentTypeId: defaultsCtId,
          data: {
            title: `Defaults Update ${Date.now()}`,
            flag: true,
            qty: 5,
            state: 'live',
          },
        },
      });
      expect(created.data.flag).toBe(true);

      // PUT a payload that OMITS `flag`. Defaults are create-only, so the
      // absent `flag` must NOT be seeded to `false` — validateEntryData maps an
      // absent optional field to null.
      const updated = await $fetch<EntryResponse>(
        `/api/entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie, 'X-Forwarded-For': '203.0.113.74' },
          body: {
            data: {
              title: `Defaults Update ${Date.now()}`,
              qty: 7,
              state: 'live',
            },
          },
        }
      );
      expect(updated.data.flag).not.toBe(false);
      expect(updated.data.flag).toBeNull();
    });
  });
});
