import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type Fixture = {
  id: string;
  name: string;
  teamId: string | null;
  opponentId: string | null;
  competitionId: string | null;
  seasonId: string | null;
  isHome: boolean;
  status: string;
};

type FixturesResponse = { items: Fixture[]; total: number };

function getFixtures(params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<FixturesResponse>(`/api/fixtures${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

describe('Fixtures API', async () => {
  await setup({ dev: true });

  // ── Default listing ───────────────────────────────────────────

  it('returns all fixtures with correct shape', async () => {
    const { items, total } = await getFixtures();
    expect(items).toBeInstanceOf(Array);
    expect(total).toBe(3);
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveProperty('id');
    expect(items[0]).toHaveProperty('name');
    expect(items[0]).toHaveProperty('isHome');
    expect(items[0]).toHaveProperty('status');
  });

  // ── Pagination ────────────────────────────────────────────────

  describe('pagination', () => {
    it('respects perPage limit', async () => {
      const { items, total } = await getFixtures({ perPage: 1 });
      expect(items).toHaveLength(1);
      expect(total).toBe(3);
    });

    it('returns different items on page 2', async () => {
      const page1 = await getFixtures({ perPage: 1, page: 1 });
      const page2 = await getFixtures({ perPage: 1, page: 2 });
      expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
    });

    it('returns empty items for page beyond total', async () => {
      const { items, total } = await getFixtures({ perPage: 1, page: 100 });
      expect(items).toHaveLength(0);
      expect(total).toBe(3);
    });
  });

  // ── Relation filters ──────────────────────────────────────────

  describe('relation filters', () => {
    it('filters by teamId', async () => {
      const all = await getFixtures();
      const teamId = all.items[0]!.teamId!;
      const { items, total } = await getFixtures({ teamId });
      expect(total).toBe(3);
      expect(items.every((f) => f.teamId === teamId)).toBe(true);
    });

    it('filters by opponentId', async () => {
      const all = await getFixtures();
      const opponentId = all.items[0]!.opponentId!;
      const { items, total } = await getFixtures({ opponentId });
      expect(total).toBe(1);
      expect(items[0]!.opponentId).toBe(opponentId);
    });

    it('filters by competitionId', async () => {
      const all = await getFixtures();
      const competitionIds = [
        ...new Set(all.items.map((f) => f.competitionId)),
      ];

      for (const competitionId of competitionIds) {
        const { items } = await getFixtures({ competitionId: competitionId! });
        expect(items.every((f) => f.competitionId === competitionId)).toBe(
          true
        );
      }
    });

    it('filters by seasonId', async () => {
      const all = await getFixtures();
      const seasonId = all.items[0]!.seasonId!;
      const { items, total } = await getFixtures({ seasonId });
      expect(total).toBe(3);
      expect(items.every((f) => f.seasonId === seasonId)).toBe(true);
    });

    it('returns empty for non-existent UUID', async () => {
      const { items, total } = await getFixtures({
        teamId: '00000000-0000-0000-0000-000000000000',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });
  });

  // ── Boolean & enum filters ────────────────────────────────────

  describe('boolean and enum filters', () => {
    it('filters by isHome=true', async () => {
      const { items, total } = await getFixtures({ isHome: 'true' });
      expect(total).toBe(2);
      expect(items.every((f) => f.isHome === true)).toBe(true);
    });

    it('filters by isHome=false', async () => {
      const { items, total } = await getFixtures({ isHome: 'false' });
      expect(total).toBe(1);
      expect(items[0]!.isHome).toBe(false);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getFixtures({ status: 'PUBLISHED' });
      expect(total).toBe(3);
      expect(items.every((f) => f.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT returns empty', async () => {
      const { items, total } = await getFixtures({ status: 'DRAFT' });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getFixtures({ status: 'INVALID' });
      expect(total).toBe(3);
    });
  });

  // ── Combined filters ──────────────────────────────────────────

  describe('combined filters', () => {
    it('filters by isHome and competitionId together', async () => {
      const all = await getFixtures();
      // Find a home fixture and use its competitionId
      const homeFixture = all.items.find((f) => f.isHome)!;
      const { items } = await getFixtures({
        isHome: 'true',
        competitionId: homeFixture.competitionId!,
      });
      expect(
        items.every(
          (f) =>
            f.isHome === true && f.competitionId === homeFixture.competitionId
        )
      ).toBe(true);
    });

    it('combined filters that match nothing return empty', async () => {
      const { items, total } = await getFixtures({
        isHome: 'false',
        teamId: '00000000-0000-0000-0000-000000000000',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });
  });
});
