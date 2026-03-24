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
    expect(total).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeGreaterThanOrEqual(3);
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
      expect(total).toBeGreaterThanOrEqual(3);
    });

    it('returns different items on page 2', async () => {
      const page1 = await getFixtures({ perPage: 1, page: 1 });
      const page2 = await getFixtures({ perPage: 1, page: 2 });
      expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
    });

    it('returns empty items for page beyond total', async () => {
      const all = await getFixtures();
      const beyondPage = Math.ceil(all.total / 1) + 10;
      const { items, total } = await getFixtures({
        perPage: 1,
        page: beyondPage,
      });
      expect(items).toHaveLength(0);
      expect(total).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Relation filters ──────────────────────────────────────────

  describe('relation filters', () => {
    it('filters by teamId', async () => {
      const all = await getFixtures({ status: 'PUBLISHED' });
      const teamId = all.items[0]!.teamId!;
      const { items } = await getFixtures({ teamId });
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.every((f) => f.teamId === teamId)).toBe(true);
    });

    it('filters by opponentId', async () => {
      const all = await getFixtures({ status: 'PUBLISHED' });
      const opponentId = all.items[0]!.opponentId!;
      const { items } = await getFixtures({ opponentId });
      expect(items.length).toBeGreaterThanOrEqual(1);
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
      const all = await getFixtures({ status: 'PUBLISHED' });
      const seasonId = all.items[0]!.seasonId!;
      const { items } = await getFixtures({ seasonId });
      expect(items.length).toBeGreaterThanOrEqual(3);
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
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.every((f) => f.isHome === true)).toBe(true);
    });

    it('filters by isHome=false', async () => {
      const { items, total } = await getFixtures({ isHome: 'false' });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.every((f) => f.isHome === false)).toBe(true);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getFixtures({ status: 'PUBLISHED' });
      expect(total).toBeGreaterThanOrEqual(3);
      expect(items.every((f) => f.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items } = await getFixtures({ status: 'DRAFT' });
      expect(items.every((f) => f.status === 'DRAFT')).toBe(true);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getFixtures({ status: 'INVALID' });
      expect(total).toBeGreaterThanOrEqual(3);
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

  // ── POST /api/fixtures ───────────────────────────────────────

  describe('POST /api/fixtures', () => {
    let createdSlug: string;

    it('creates a fixture with valid data', async () => {
      createdSlug = `test-fixture-${Date.now()}`;
      const response = await fetch('/api/fixtures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name: `Test Fixture ${Date.now()}`,
          slug: createdSlug,
          kickoff: '2026-04-01T15:00:00.000Z',
        }),
      });
      expect(response.status).toBe(201);
      const fixture = await response.json();
      expect(fixture.id).toBeDefined();
      expect(fixture.slug).toBe(createdSlug);
      expect(fixture.status).toBe('DRAFT');
    });

    it('returns 400 when name is missing', async () => {
      const err = await $fetch('/api/fixtures', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { slug: 'no-name', kickoff: '2026-04-01T15:00:00.000Z' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when slug is missing', async () => {
      const err = await $fetch('/api/fixtures', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name: 'No Slug', kickoff: '2026-04-01T15:00:00.000Z' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when kickoff is missing', async () => {
      const err = await $fetch('/api/fixtures', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name: 'No Kickoff', slug: 'no-kickoff' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 409 on duplicate slug', async () => {
      const err = await $fetch('/api/fixtures', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          name: 'Duplicate Fixture',
          slug: createdSlug,
          kickoff: '2026-05-01T15:00:00.000Z',
        },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        409
      );
    });
  });
});
