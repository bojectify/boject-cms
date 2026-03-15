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

// Seed totals: Team=4, Club=3, Competition=2, Season=1, Fixture=3, Player=5, Image=1
// Note: image upload tests may add additional DRAFT images, so total may be higher
const SEEDED_PUBLISHED = 19;

describe('Content API filters', async () => {
  await setup({ dev: true });

  // ── Default listing ───────────────────────────────────────────

  it('returns all content items', async () => {
    const { items, total } = await getContent({ perPage: 50 });
    expect(total).toBeGreaterThanOrEqual(SEEDED_PUBLISHED);
    expect(items.length).toBeGreaterThanOrEqual(SEEDED_PUBLISHED);
    expect(items[0]).toHaveProperty('contentType');
    expect(items[0]).toHaveProperty('entryTitle');
    expect(items[0]).toHaveProperty('status');
  });

  // ── contentType filter ────────────────────────────────────────

  describe('contentType filter', () => {
    it('filters by contentType=Team', async () => {
      const { items, total } = await getContent({ contentType: 'Team' });
      expect(total).toBe(4);
      expect(items).toHaveLength(4);
      expect(items.every((i) => i.contentType === 'Team')).toBe(true);
    });

    it('filters by contentType=Club', async () => {
      const { items, total } = await getContent({ contentType: 'Club' });
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
      expect(items.every((i) => i.contentType === 'Club')).toBe(true);
    });

    it('filters by contentType=Player', async () => {
      const { items, total } = await getContent({ contentType: 'Player' });
      expect(total).toBe(5);
      expect(items).toHaveLength(5);
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
      expect(total).toBeGreaterThanOrEqual(SEEDED_PUBLISHED);
    });
  });

  // ── status filter ─────────────────────────────────────────────

  describe('status filter', () => {
    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getContent({
        status: 'PUBLISHED',
        perPage: 50,
      });
      expect(total).toBe(SEEDED_PUBLISHED);
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
      expect(total).toBeGreaterThanOrEqual(SEEDED_PUBLISHED);
    });
  });

  // ── Combined filters ──────────────────────────────────────────

  describe('combined filters', () => {
    it('filters by contentType and status together', async () => {
      const { items, total } = await getContent({
        contentType: 'Team',
        status: 'PUBLISHED',
      });
      expect(total).toBe(4);
      expect(
        items.every((i) => i.contentType === 'Team' && i.status === 'PUBLISHED')
      ).toBe(true);
    });

    it('contentType + status=DRAFT returns empty', async () => {
      const { items, total } = await getContent({
        contentType: 'Team',
        status: 'DRAFT',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });
  });
});
