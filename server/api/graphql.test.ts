import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

type GqlResponse<T> = { data: T; errors?: { message: string }[] };

function gql<T>(query: string) {
  return $fetch<GqlResponse<T>>('/api/graphql', {
    method: 'POST',
    body: { query },
  });
}

describe('GraphQL API', async () => {
  await setup({ dev: true });

  // ── List queries ──────────────────────────────────────────────

  describe('list queries', () => {
    it('returns all teams', async () => {
      const { data } = await gql<{ teams: { id: string; name: string }[] }>(
        '{ teams { id name } }'
      );
      expect(data.teams).toBeInstanceOf(Array);
      expect(data.teams.length).toBeGreaterThanOrEqual(4);
      expect(data.teams[0]).toHaveProperty('id');
      expect(data.teams[0]).toHaveProperty('name');
    });

    it('returns all clubs', async () => {
      const { data } = await gql<{ clubs: { id: string; name: string }[] }>(
        '{ clubs { id name } }'
      );
      expect(data.clubs.length).toBeGreaterThanOrEqual(3);
    });

    it('returns all players', async () => {
      const { data } = await gql<{
        players: { id: string; firstName: string; lastName: string }[];
      }>('{ players { id firstName lastName } }');
      expect(data.players.length).toBeGreaterThanOrEqual(5);
      expect(data.players[0]).toHaveProperty('firstName');
      expect(data.players[0]).toHaveProperty('lastName');
    });

    it('returns all positions', async () => {
      const { data } = await gql<{
        positions: { id: string; name: string }[];
      }>('{ positions { id name } }');
      expect(data.positions.length).toBeGreaterThanOrEqual(14);
    });

    it('returns all seasons', async () => {
      const { data } = await gql<{
        seasons: { id: string; name: string; startDate: string }[];
      }>('{ seasons { id name startDate } }');
      expect(data.seasons.length).toBeGreaterThanOrEqual(1);
      expect(data.seasons[0]).toHaveProperty('startDate');
    });

    it('returns all competitions', async () => {
      const { data } = await gql<{
        competitions: { id: string; name: string }[];
      }>('{ competitions { id name } }');
      expect(data.competitions.length).toBeGreaterThanOrEqual(2);
    });

    it('returns all fixtures', async () => {
      const { data } = await gql<{
        fixtures: {
          id: string;
          name: string;
          isHome: boolean;
          venue: string;
        }[];
      }>('{ fixtures { id name isHome venue } }');
      expect(data.fixtures.length).toBeGreaterThanOrEqual(3);
      expect(data.fixtures[0]).toHaveProperty('isHome');
    });

    it('returns all scores', async () => {
      const { data } = await gql<{
        scores: { id: string; type: string; minute: number | null }[];
      }>('{ scores { id type minute } }');
      expect(data.scores.length).toBeGreaterThanOrEqual(9);
    });
  });

  // ── Single-item queries ───────────────────────────────────────

  describe('single-item queries', () => {
    it('fetches a team by ID', async () => {
      const { data: list } = await gql<{
        teams: { id: string; name: string }[];
      }>('{ teams { id name } }');
      const first = list.teams[0];

      const { data } = await gql<{ team: { id: string; name: string } }>(
        `{ team(id: "${first.id}") { id name } }`
      );
      expect(data.team.id).toBe(first.id);
      expect(data.team.name).toBe(first.name);
    });

    it('fetches a player by ID', async () => {
      const { data: list } = await gql<{
        players: { id: string; firstName: string }[];
      }>('{ players { id firstName } }');
      const first = list.players[0];

      const { data } = await gql<{
        player: { id: string; firstName: string };
      }>(`{ player(id: "${first.id}") { id firstName } }`);
      expect(data.player.id).toBe(first.id);
    });

    it('returns null for a non-existent ID', async () => {
      const { data } = await gql<{ team: null }>(
        '{ team(id: "00000000-0000-0000-0000-000000000000") { id name } }'
      );
      expect(data.team).toBeNull();
    });
  });

  // ── Relation resolution ───────────────────────────────────────

  describe('relation resolution', () => {
    it('resolves player relations', async () => {
      const { data } = await gql<{
        players: {
          id: string;
          firstName: string;
          position: { name: string } | null;
          teamHistory: { team: { name: string } }[];
          scores: { type: string }[];
        }[];
      }>(`{
        players {
          id firstName
          position { name }
          teamHistory { team { name } }
          scores { type }
        }
      }`);
      const withPosition = data.players.find((p) => p.position !== null);
      expect(withPosition).toBeDefined();
      expect(withPosition!.position!.name).toBeTruthy();

      const withHistory = data.players.find((p) => p.teamHistory.length > 0);
      expect(withHistory).toBeDefined();
    });

    it('resolves fixture relations', async () => {
      const { data } = await gql<{
        fixtures: {
          id: string;
          name: string;
          team: { name: string } | null;
          opponent: { name: string } | null;
          competition: { name: string } | null;
          season: { name: string } | null;
          scores: { type: string; minute: number | null }[];
        }[];
      }>(`{
        fixtures {
          id name
          team { name }
          opponent { name }
          competition { name }
          season { name }
          scores { type minute }
        }
      }`);
      const withScores = data.fixtures.find((f) => f.scores.length > 0);
      expect(withScores).toBeDefined();
      expect(withScores!.scores[0]).toHaveProperty('type');
    });

    it('resolves competition relations', async () => {
      const { data } = await gql<{
        competitions: {
          id: string;
          name: string;
          season: { name: string } | null;
          teams: { team: { name: string } }[];
        }[];
      }>(`{
        competitions {
          id name
          season { name }
          teams { team { name } }
        }
      }`);
      const withSeason = data.competitions.find((c) => c.season !== null);
      expect(withSeason).toBeDefined();
    });
  });

  // ── Where filtering ───────────────────────────────────────────

  describe('where filtering', () => {
    it('filters clubs by name contains', async () => {
      const { data } = await gql<{ clubs: { id: string; name: string }[] }>(
        '{ clubs(where: { name: { contains: "RFC" } }) { id name } }'
      );
      expect(data.clubs.length).toBe(3);
      data.clubs.forEach((club) => {
        expect(club.name).toContain('RFC');
      });
    });

    it('filters players by exact firstName', async () => {
      const { data } = await gql<{
        players: { id: string; firstName: string; lastName: string }[];
      }>(
        '{ players(where: { firstName: { equals: "Tom" } }) { id firstName lastName } }'
      );
      expect(data.players.length).toBe(1);
      expect(data.players[0].firstName).toBe('Tom');
      expect(data.players[0].lastName).toBe('Evans');
    });

    it('filters fixtures by isHome', async () => {
      const { data } = await gql<{
        fixtures: { id: string; name: string; isHome: boolean }[];
      }>(
        '{ fixtures(where: { isHome: { equals: true } }) { id name isHome } }'
      );
      expect(data.fixtures.length).toBeGreaterThan(0);
      data.fixtures.forEach((f) => {
        expect(f.isHome).toBe(true);
      });
    });

    it('filters scores by type', async () => {
      const { data } = await gql<{
        scores: { id: string; type: string }[];
      }>('{ scores(where: { type: { equals: TRY } }) { id type } }');
      expect(data.scores.length).toBeGreaterThan(0);
      data.scores.forEach((s) => {
        expect(s.type).toBe('TRY');
      });
    });

    it('returns empty array for no matches', async () => {
      const { data } = await gql<{ clubs: { id: string }[] }>(
        '{ clubs(where: { name: { equals: "Nonexistent Club" } }) { id } }'
      );
      expect(data.clubs).toEqual([]);
    });
  });
});
