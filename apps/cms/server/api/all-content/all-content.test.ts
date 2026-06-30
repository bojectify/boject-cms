import { describe, it, expect, beforeAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { getTestDatabaseUrl } from '../../../test/dbUrl';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

const prismaUrl = getTestDatabaseUrl();
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

type ContentItem = {
  id: string;
  entryTitle: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contentType: string;
  contentTypeId: string;
};

type ContentResponse = {
  items: ContentItem[];
  pageInfo?: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};

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

async function getContent(params: Record<string, string | number> = {}) {
  const cookie = await getSessionCookie();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ContentResponse>(`/api/all-content${qs ? `?${qs}` : ''}`, {
    headers: { cookie },
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
    await $fetch<EntryResponse>('/api/entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Published Blog 1 ${Date.now()}` },
        status: CONTENT_STATUSES.PUBLISHED,
      },
    });
    await $fetch<EntryResponse>('/api/entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Published Blog 2 ${Date.now()}` },
        status: CONTENT_STATUSES.PUBLISHED,
      },
    });
    await $fetch<EntryResponse>('/api/entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title: `Draft Blog ${Date.now()}` },
        status: CONTENT_STATUSES.DRAFT,
      },
    });

    // Seed entries for the second content type
    await $fetch<EntryResponse>('/api/entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: secondType.id,
        data: { title: `Published News ${Date.now()}` },
        status: CONTENT_STATUSES.PUBLISHED,
      },
    });
  });

  // ── entryKey (#205) ───────────────────────────────────────────

  it('GET /api/all-content includes entryKey on every item (#205)', async () => {
    const cookie = await getSessionCookie();
    const suffix = Date.now();
    const title = `Unified Listing ${suffix}`;
    const expectedKey = `unified-listing-${suffix}`;

    await $fetch<EntryResponse>('/api/entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogPostType.id,
        data: { title },
        status: CONTENT_STATUSES.PUBLISHED,
      },
    });

    const { items } = await $fetch<{
      items: Array<ContentItem & { entryKey: string }>;
    }>(`/api/all-content?contentType=${blogPostType.identifier}&perPage=100`, {
      headers: { cookie },
    });

    expect(items.every((i) => typeof i.entryKey === 'string')).toBe(true);
    const found = items.find((i) => i.entryKey === expectedKey);
    expect(found).toBeDefined();
  });

  // ── Default listing ───────────────────────────────────────────

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('returns all content items including drafts', async () => {
    // Session sees all entries (2 published blogs + 1 draft blog + 1 published news)
    const { items } = await getContent({ perPage: 50 });
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items[0]).toHaveProperty('contentType');
    expect(items[0]).toHaveProperty('contentTypeId');
    expect(items[0]).toHaveProperty('entryTitle');
    expect(items[0]).toHaveProperty('status');
    expect(typeof items[0]!.contentType).toBe('string');
    expect(typeof items[0]!.contentTypeId).toBe('string');
    expect(items[0]!.contentTypeId).toMatch(UUID_RE);
  });

  it('cursor-paginates with pageInfo and no total', async () => {
    const p1 = await getContent({ perPage: 2 });
    expect(p1).toHaveProperty('pageInfo');
    expect(p1).not.toHaveProperty('total');
    expect(p1.items.length).toBeLessThanOrEqual(2);
    if (p1.pageInfo!.hasNextPage) {
      const p2 = await getContent({
        perPage: 2,
        after: p1.pageInfo!.endCursor!,
      });
      // No overlap between consecutive pages.
      const p1ids = new Set(p1.items.map((i) => i.id));
      expect(p2.items.every((i) => !p1ids.has(i.id))).toBe(true);
    }
  });

  // ── contentType filter ────────────────────────────────────────

  describe('contentType filter', () => {
    it('filters by dynamic identifier (session sees all)', async () => {
      const { items } = await getContent({
        contentType: blogPostType.identifier,
        perPage: 50,
      });
      // Session sees all 3 blog entries (2 published + 1 draft)
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.contentType === blogPostType.name)).toBe(
        true
      );
    });

    it('returns empty for unknown contentType identifier', async () => {
      const { items } = await getContent({
        contentType: 'DoesNotExist',
        perPage: 50,
      });
      expect(items).toEqual([]);
    });
  });

  // ── status filter ─────────────────────────────────────────────

  describe('status filter', () => {
    it('filters by status=PUBLISHED (all items have a string contentType)', async () => {
      const { items } = await getContent({
        status: CONTENT_STATUSES.PUBLISHED,
        perPage: 100,
      });
      expect(items.every((i) => i.status === CONTENT_STATUSES.PUBLISHED)).toBe(
        true
      );
      expect(items.every((i) => typeof i.contentType === 'string')).toBe(true);
      expect(
        items.every(
          (i) =>
            typeof i.contentTypeId === 'string' && UUID_RE.test(i.contentTypeId)
        )
      ).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getContent({
        status: CONTENT_STATUSES.DRAFT,
        perPage: 100,
      });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === CONTENT_STATUSES.DRAFT)).toBe(
        true
      );
    });

    it('ignores an unrecognised status value and returns the default listing', async () => {
      // The handler silently ignores an invalid status (treated as no filter),
      // so it returns the same set as an unfiltered call. Comparing to a
      // baseline keeps this robust to the shared test DB's row count (an
      // absolute count is fragile across the full suite). Restores the coverage
      // an API-key-only test held before the #257 token-strip migration.
      const baseline = await getContent({ perPage: 100 });
      const invalid = await getContent({ status: 'INVALID', perPage: 100 });
      expect(invalid.items.length).toBe(baseline.items.length);
    });
  });

  // ── Combined filters ──────────────────────────────────────────

  describe('combined filters', () => {
    it('filters by contentType and status together', async () => {
      const { items } = await getContent({
        contentType: blogPostType.identifier,
        status: CONTENT_STATUSES.PUBLISHED,
      });
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(
        items.every(
          (i) =>
            i.contentType === blogPostType.name &&
            i.status === CONTENT_STATUSES.PUBLISHED
        )
      ).toBe(true);
    });

    it('contentType + status=DRAFT', async () => {
      const { items } = await getContent({
        contentType: blogPostType.identifier,
        status: CONTENT_STATUSES.DRAFT,
      });
      expect(
        items.every(
          (i) =>
            i.contentType === blogPostType.name &&
            i.status === CONTENT_STATUSES.DRAFT
        )
      ).toBe(true);
    });
  });

  // ── Many-version resolution (#264) ────────────────────────────

  describe('resolves one version per entry regardless of version count (#264)', () => {
    it('returns the draft-priority version + unchanged item shape for an entry with many ARCHIVED versions', async () => {
      const cookie = await getSessionCookie();

      // Dedicated content type so the count assertions are unaffected by
      // the shared fixtures seeded in beforeAll.
      const manyVersionType = await $fetch<ContentTypeResponse>(
        '/api/content-types',
        {
          method: 'POST',
          headers: { cookie },
          body: {
            name: `Content Filter Many Versions ${Date.now()}`,
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
              },
            ],
          },
        }
      );

      const entryTitle = `Many Versions Entry ${Date.now()}`;
      const entry = await prisma.contentEntry.create({
        data: {
          contentTypeId: manyVersionType.id,
          entryTitle,
          entryKey: `many-versions-entry-${Date.now()}`,
        },
      });

      // One PUBLISHED version, one CHANGED draft (draft-priority winner for
      // session/CMS auth), plus ~25 ARCHIVED versions to prove resolution
      // does not depend on eager-loading every version row.
      await prisma.contentEntryVersion.create({
        data: {
          entryId: entry.id,
          data: { title: entryTitle },
          entryTitle,
          status: CONTENT_STATUSES.PUBLISHED,
          publishedAt: new Date(),
        },
      });
      await prisma.contentEntryVersion.create({
        data: {
          entryId: entry.id,
          data: { title: entryTitle },
          entryTitle,
          status: CONTENT_STATUSES.CHANGED,
        },
      });
      await prisma.contentEntryVersion.createMany({
        data: Array.from({ length: 25 }, () => ({
          entryId: entry.id,
          data: { title: entryTitle },
          entryTitle,
          status: CONTENT_STATUSES.ARCHIVED,
          publishedAt: new Date(),
        })),
      });

      // archiveFilter=all so the entry surfaces despite carrying ARCHIVED
      // versions (the default 'active' filter excludes any entry with an
      // archived version at the WHERE level). draft-priority then picks the
      // CHANGED version over PUBLISHED.
      const { items } = await getContent({
        contentType: manyVersionType.identifier,
        perPage: 50,
        archiveFilter: 'all',
      });

      const found = items.find((i) => i.id === entry.id);
      expect(found).toBeDefined();
      // Session/CMS auth resolves draft-priority: CHANGED beats PUBLISHED.
      expect(found!.status).toBe(CONTENT_STATUSES.CHANGED);
      // Response item shape is unchanged.
      expect(Object.keys(found!).sort()).toEqual([
        'contentType',
        'contentTypeId',
        'createdAt',
        'entryKey',
        'entryTitle',
        'id',
        'status',
        'updatedAt',
      ]);
    });
  });
});
