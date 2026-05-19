import { describe, it, expect, beforeAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { FIELD_TYPES } from '../../../utils/fieldTypes';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type ContentItem = {
  id: string;
  entryTitle: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contentType: string;
  contentTypeId: string;
};

type ContentResponse = { items: ContentItem[]; total: number };

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
  entryTitle: string;
  status: string;
};

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

function getContent(
  params: Record<string, string | number> = {},
  auth: 'apikey' | 'session' = 'apikey'
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  const headers: Record<string, string> =
    auth === 'apikey' ? { Authorization: `Bearer ${TEST_API_KEY}` } : {};
  return auth === 'session'
    ? getSessionCookie().then((cookie) =>
        $fetch<ContentResponse>(`/api/content${qs ? `?${qs}` : ''}`, {
          headers: { cookie },
        })
      )
    : $fetch<ContentResponse>(`/api/content${qs ? `?${qs}` : ''}`, {
        headers,
      });
}

let blogPostType: ContentTypeResponse;
let secondType: ContentTypeResponse;

describe('Content API filters', async () => {
  await setup({ dev: true });

  beforeAll(async () => {
    const cookie = await getSessionCookie();

    // Create a dynamic "BlogPost" content type with a mix of statuses
    blogPostType = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Content Filter Blog Post ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: FIELD_TYPES.SLUG },
        ],
      },
    });

    // Create a second content type so contentType filtering can be verified
    secondType = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Content Filter News ${Date.now()}`,
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

    // Seed entries for the blog post type: 2 PUBLISHED, 1 DRAFT
    await $fetch<EntryResponse>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Published Blog 1 ${Date.now()}` },
        status: 'PUBLISHED',
      },
    });
    await $fetch<EntryResponse>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Published Blog 2 ${Date.now()}` },
        status: 'PUBLISHED',
      },
    });
    await $fetch<EntryResponse>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Draft Blog ${Date.now()}` },
        status: 'DRAFT',
      },
    });

    // Seed entries for the second content type
    await $fetch<EntryResponse>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: secondType.id,
        data: { title: `Published News ${Date.now()}` },
        status: 'PUBLISHED',
      },
    });
  });

  // ── entryKey (#205) ───────────────────────────────────────────

  it('GET /api/content includes entryKey on every item (#205)', async () => {
    const cookie = await getSessionCookie();
    const suffix = Date.now();
    const title = `Unified Listing ${suffix}`;
    const expectedKey = `unified-listing-${suffix}`;

    await $fetch<EntryResponse>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title },
        status: 'PUBLISHED',
      },
    });

    const { items } = await $fetch<{
      items: Array<ContentItem & { entryKey: string }>;
      total: number;
    }>(`/api/content?contentType=${blogPostType.identifier}&perPage=100`, {
      headers: { cookie },
    });

    expect(items.every((i) => typeof i.entryKey === 'string')).toBe(true);
    const found = items.find((i) => i.entryKey === expectedKey);
    expect(found).toBeDefined();
  });

  // ── Default listing ───────────────────────────────────────────

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('returns all published content items (API key)', async () => {
    // API key only sees entries with a PUBLISHED version (3 published: 2 blog + 1 news)
    const { items, total } = await getContent({ perPage: 50 });
    expect(total).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    expect(items[0]).toHaveProperty('contentType');
    expect(items[0]).toHaveProperty('contentTypeId');
    expect(items[0]).toHaveProperty('entryTitle');
    expect(items[0]).toHaveProperty('status');
    expect(typeof items[0]!.contentType).toBe('string');
    expect(typeof items[0]!.contentTypeId).toBe('string');
    expect(items[0]!.contentTypeId).toMatch(UUID_RE);
  });

  it('returns all content items including drafts (session)', async () => {
    // Session sees all entries (2 published blogs + 1 draft blog + 1 published news)
    const { items, total } = await getContent({ perPage: 50 }, 'session');
    expect(total).toBeGreaterThanOrEqual(4);
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items[0]).toHaveProperty('contentType');
    expect(items[0]).toHaveProperty('entryTitle');
  });

  it('paginates results', async () => {
    const { items } = await getContent({ page: 1, perPage: 2 });
    expect(items.length).toBeLessThanOrEqual(2);
  });

  // ── contentType filter ────────────────────────────────────────

  describe('contentType filter', () => {
    it('filters by dynamic identifier (API key sees only published)', async () => {
      const { items, total } = await getContent({
        contentType: blogPostType.identifier,
        perPage: 50,
      });
      // API key only sees the 2 published blog entries (not the draft)
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.every((i) => i.contentType === blogPostType.name)).toBe(
        true
      );
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by dynamic identifier (session sees all)', async () => {
      const { items, total } = await getContent(
        { contentType: blogPostType.identifier, perPage: 50 },
        'session'
      );
      // Session sees all 3 blog entries (2 published + 1 draft)
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.contentType === blogPostType.name)).toBe(
        true
      );
    });

    it('returns empty for unknown contentType identifier', async () => {
      const { items, total } = await getContent({
        contentType: 'DoesNotExist',
        perPage: 50,
      });
      expect(total).toBe(0);
      expect(items).toEqual([]);
    });
  });

  // ── status filter ─────────────────────────────────────────────

  describe('status filter', () => {
    it('filters by status=PUBLISHED and all items have a string contentType', async () => {
      const { items, total } = await getContent({
        status: 'PUBLISHED',
        perPage: 100,
      });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
      expect(items.every((i) => typeof i.contentType === 'string')).toBe(true);
      expect(
        items.every(
          (i) =>
            typeof i.contentTypeId === 'string' && UUID_RE.test(i.contentTypeId)
        )
      ).toBe(true);
    });

    it('filters by status=DRAFT (session auth required)', async () => {
      // API key only sees PUBLISHED, so DRAFT filter via API key returns empty.
      // Use session auth to verify DRAFT filter works.
      const { items } = await getContent(
        { status: 'DRAFT', perPage: 100 },
        'session'
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === 'DRAFT')).toBe(true);
    });

    it('API key ignores invalid status values and returns only published', async () => {
      const { items, total } = await getContent({
        status: 'INVALID',
        perPage: 50,
      });
      // API key sees only published entries; invalid status is ignored
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });
  });

  // ── Combined filters ──────────────────────────────────────────

  describe('combined filters', () => {
    it('filters by contentType and status together', async () => {
      const { items, total } = await getContent({
        contentType: blogPostType.identifier,
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(2);
      expect(
        items.every(
          (i) => i.contentType === blogPostType.name && i.status === 'PUBLISHED'
        )
      ).toBe(true);
    });

    it('contentType + status=DRAFT (session auth)', async () => {
      // Use session auth — API key cannot see DRAFT entries
      const { items } = await getContent(
        {
          contentType: blogPostType.identifier,
          status: 'DRAFT',
        },
        'session'
      );
      expect(
        items.every(
          (i) => i.contentType === blogPostType.name && i.status === 'DRAFT'
        )
      ).toBe(true);
    });
  });
});
