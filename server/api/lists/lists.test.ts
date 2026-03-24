import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

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

describe('List endpoint filters', async () => {
  await setup({ dev: true });

  // ── Teams (status only, 4 seeded) ─────────────────────────────

  describe('teams', () => {
    it('returns all teams', async () => {
      const { items, total } = await getList('teams');
      expect(total).toBeGreaterThanOrEqual(4);
      expect(items.length).toBeGreaterThanOrEqual(4);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('teams', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(4);
      expect(items.every((t) => t.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('teams', { status: 'DRAFT' });
      expect(items.every((t) => t.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('teams', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Clubs (status only, 3 seeded) ─────────────────────────────

  describe('clubs', () => {
    it('returns all clubs', async () => {
      const { items, total } = await getList('clubs');
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeGreaterThanOrEqual(3);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('clubs', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((c) => c.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('clubs', { status: 'DRAFT' });
      expect(items.every((c) => c.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('clubs', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Seasons (status only, 1 seeded) ───────────────────────────

  describe('seasons', () => {
    it('returns all seasons', async () => {
      const { items, total } = await getList('seasons');
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('seasons', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.every((s) => s.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('seasons', {
        status: 'DRAFT',
      });
      expect(items.every((s) => s.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('seasons', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Images (status only, 1+ seeded — count may vary if upload tests ran first) ──

  describe('images', () => {
    it('returns at least the seeded image', async () => {
      const { items, total } = await getList('images');
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items } = await getList('images', {
        status: 'PUBLISHED',
      });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('images', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Players (positionId + status, 5 seeded) ───────────────────

  describe('players', () => {
    it('returns all players', async () => {
      const { items, total } = await getList('players');
      expect(total).toBeGreaterThanOrEqual(5);
      expect(items.length).toBeGreaterThanOrEqual(5);
    });

    it('filters by positionId', async () => {
      const all = await getList('players', { status: 'PUBLISHED' });
      const positionId = all.items[0]!.positionId as string;
      const { items } = await getList('players', { positionId });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.every((p) => p.positionId === positionId)).toBe(true);
    });

    it('returns empty for non-existent positionId', async () => {
      const { items, total } = await getList('players', {
        positionId: '00000000-0000-0000-0000-000000000000',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('players', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(5);
      expect(items.every((p) => p.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('players', {
        status: 'DRAFT',
      });
      expect(items.every((p) => p.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('players', { status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(5);
    });

    it('combines positionId and status filters', async () => {
      const all = await getList('players', { status: 'PUBLISHED' });
      const positionId = all.items[0]!.positionId as string;
      const { items } = await getList('players', {
        positionId,
        status: 'PUBLISHED',
      });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(
        items.every(
          (p) => p.positionId === positionId && p.status === 'PUBLISHED'
        )
      ).toBe(true);
    });
  });

  // ── Competitions (seasonId + status, 2 seeded) ────────────────

  describe('competitions', () => {
    it('returns all competitions', async () => {
      const { items, total } = await getList('competitions');
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by seasonId', async () => {
      const all = await getList('competitions', { status: 'PUBLISHED' });
      const seasonId = all.items[0]!.seasonId as string;
      const { items } = await getList('competitions', { seasonId });
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.every((c) => c.seasonId === seasonId)).toBe(true);
    });

    it('returns empty for non-existent seasonId', async () => {
      const { items, total } = await getList('competitions', {
        seasonId: '00000000-0000-0000-0000-000000000000',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('competitions', {
        status: 'PUBLISHED',
      });
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.every((c) => c.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getList('competitions', {
        status: 'DRAFT',
      });
      expect(items.every((c) => c.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('competitions', {
        status: 'INVALID',
      });
      expect(total).toBeGreaterThanOrEqual(2);
    });

    it('combines seasonId and status filters', async () => {
      const all = await getList('competitions', { status: 'PUBLISHED' });
      const seasonId = all.items[0]!.seasonId as string;
      const { items } = await getList('competitions', {
        seasonId,
        status: 'PUBLISHED',
      });
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(
        items.every((c) => c.seasonId === seasonId && c.status === 'PUBLISHED')
      ).toBe(true);
    });
  });
});
