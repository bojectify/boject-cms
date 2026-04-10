import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type ContentItem = {
  id: string;
  entryTitle: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contentType: string;
};

type ContentResponse = { items: ContentItem[]; total: number };

function getContent(params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ContentResponse>(`/api/content${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

// Minimum seeded PUBLISHED count: Team=4, Club=3, Competition=2, Season=1, Fixture=3, Player=5, Image=1, Author=2, Tag=3, Article=2
const MIN_SEEDED_PUBLISHED = 26;

describe('Content API filters', async () => {
  await setup({ dev: true });

  // ── Default listing ───────────────────────────────────────────

  it('returns all content items', async () => {
    const { items, total } = await getContent({ perPage: 50 });
    expect(total).toBeGreaterThanOrEqual(MIN_SEEDED_PUBLISHED);
    expect(items.length).toBeGreaterThanOrEqual(MIN_SEEDED_PUBLISHED);
    expect(items[0]).toHaveProperty('contentType');
    expect(items[0]).toHaveProperty('entryTitle');
    expect(items[0]).toHaveProperty('status');
  });

  // ── contentType filter ────────────────────────────────────────

  describe('contentType filter', () => {
    it('filters by contentType=Team', async () => {
      const { items, total } = await getContent({ contentType: 'Team' });
      expect(total).toBeGreaterThanOrEqual(4);
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items.every((i) => i.contentType === 'Team')).toBe(true);
    });

    it('filters by contentType=Club', async () => {
      const { items, total } = await getContent({ contentType: 'Club' });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.contentType === 'Club')).toBe(true);
    });

    it('filters by contentType=Player', async () => {
      const { items, total } = await getContent({ contentType: 'Player' });
      expect(total).toBeGreaterThanOrEqual(5);
      expect(items.length).toBeGreaterThanOrEqual(5);
      expect(items.every((i) => i.contentType === 'Player')).toBe(true);
    });

    it('filters by contentType=Image', async () => {
      const { items, total } = await getContent({ contentType: 'Image' });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('ignores invalid contentType', async () => {
      const { total } = await getContent({
        contentType: 'NonExistent',
        perPage: 50,
      });
      expect(total).toBeGreaterThanOrEqual(MIN_SEEDED_PUBLISHED);
    });

    it('filters by contentType=Author', async () => {
      const { items, total } = await getContent({ contentType: 'Author' });
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.every((i) => i.contentType === 'Author')).toBe(true);
    });

    it('filters by contentType=Tag', async () => {
      const { items, total } = await getContent({ contentType: 'Tag' });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.contentType === 'Tag')).toBe(true);
    });

    it('filters by contentType=Article', async () => {
      const { items, total } = await getContent({ contentType: 'Article' });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.contentType === 'Article')).toBe(true);
    });
  });

  // ── status filter ─────────────────────────────────────────────

  describe('status filter', () => {
    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getContent({
        status: 'PUBLISHED',
        perPage: 50,
      });
      expect(total).toBeGreaterThanOrEqual(MIN_SEEDED_PUBLISHED);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getContent({ status: 'DRAFT' });
      expect(items.every((i) => i.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getContent({
        status: 'INVALID',
        perPage: 50,
      });
      expect(total).toBeGreaterThanOrEqual(MIN_SEEDED_PUBLISHED);
    });
  });

  // ── Combined filters ──────────────────────────────────────────

  describe('combined filters', () => {
    it('filters by contentType and status together', async () => {
      const { items, total } = await getContent({
        contentType: 'Team',
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(4);
      expect(
        items.every((i) => i.contentType === 'Team' && i.status === 'PUBLISHED')
      ).toBe(true);
    });

    it('contentType=Team + status=DRAFT', async () => {
      const { items } = await getContent({
        contentType: 'Team',
        status: 'DRAFT',
      });
      expect(
        items.every((i) => i.contentType === 'Team' && i.status === 'DRAFT')
      ).toBe(true);
    });
  });

  it('filters by contentType=Link', async () => {
    const { items, total } = await getContent({ contentType: 'Link' });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => i.contentType === 'Link')).toBe(true);
  });

  it('filters by contentType=Navigation', async () => {
    const { items, total } = await getContent({ contentType: 'Navigation' });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => i.contentType === 'Navigation')).toBe(true);
  });
});
