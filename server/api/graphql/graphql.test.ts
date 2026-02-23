import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

type GqlResponse<T> = { data: T; errors?: { message: string }[] };

function gql<T>(query: string) {
  return $fetch<GqlResponse<T>>('/api/graphql', {
    method: 'POST',
    body: { query },
  });
}

type Edge<T> = { node: T; cursor: string };
type Connection<T> = {
  edges: Edge<T>[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};

describe('GraphQL API', async () => {
  await setup({ dev: true });

  // ── List queries ──────────────────────────────────────────────

  describe('list queries', () => {
    it('returns all teams', async () => {
      const { data } = await gql<{
        teams: Connection<{ id: string; name: string }>;
      }>('{ teams { edges { node { id name } } } }');
      expect(data.teams.edges).toBeInstanceOf(Array);
      expect(data.teams.edges.length).toBeGreaterThanOrEqual(4);
      expect(data.teams.edges[0]!.node).toHaveProperty('id');
      expect(data.teams.edges[0]!.node).toHaveProperty('name');
    });

    it('returns all clubs', async () => {
      const { data } = await gql<{
        clubs: Connection<{ id: string; name: string }>;
      }>('{ clubs { edges { node { id name } } } }');
      expect(data.clubs.edges.length).toBeGreaterThanOrEqual(3);
    });

    it('returns all players', async () => {
      const { data } = await gql<{
        players: Connection<{
          id: string;
          firstName: string;
          lastName: string;
        }>;
      }>('{ players { edges { node { id firstName lastName } } } }');
      expect(data.players.edges.length).toBeGreaterThanOrEqual(5);
      expect(data.players.edges[0]!.node).toHaveProperty('firstName');
      expect(data.players.edges[0]!.node).toHaveProperty('lastName');
    });

    it('returns all positions', async () => {
      const { data } = await gql<{
        positions: Connection<{ id: string; name: string }>;
      }>('{ positions { edges { node { id name } } } }');
      expect(data.positions.edges.length).toBeGreaterThanOrEqual(14);
    });

    it('returns all seasons', async () => {
      const { data } = await gql<{
        seasons: Connection<{
          id: string;
          name: string;
          startDate: string;
        }>;
      }>('{ seasons { edges { node { id name startDate } } } }');
      expect(data.seasons.edges.length).toBeGreaterThanOrEqual(1);
      expect(data.seasons.edges[0]!.node).toHaveProperty('startDate');
    });

    it('returns all competitions', async () => {
      const { data } = await gql<{
        competitions: Connection<{ id: string; name: string }>;
      }>('{ competitions { edges { node { id name } } } }');
      expect(data.competitions.edges.length).toBeGreaterThanOrEqual(2);
    });

    it('returns all fixtures', async () => {
      const { data } = await gql<{
        fixtures: Connection<{
          id: string;
          name: string;
          isHome: boolean;
          venue: string;
        }>;
      }>('{ fixtures { edges { node { id name isHome venue } } } }');
      expect(data.fixtures.edges.length).toBeGreaterThanOrEqual(3);
      expect(data.fixtures.edges[0]!.node).toHaveProperty('isHome');
    });

    it('returns all scores', async () => {
      const { data } = await gql<{
        scores: Connection<{
          id: string;
          type: string;
          minute: number | null;
        }>;
      }>('{ scores { edges { node { id type minute } } } }');
      expect(data.scores.edges.length).toBeGreaterThanOrEqual(9);
    });
  });

  // ── Single-item queries ───────────────────────────────────────

  describe('single-item queries', () => {
    it('fetches a team by ID', async () => {
      const { data: list } = await gql<{
        teams: Connection<{ id: string; name: string }>;
      }>('{ teams { edges { node { id name } } } }');
      const first = list.teams.edges[0]!.node;

      const { data } = await gql<{ team: { id: string; name: string } }>(
        `{ team(id: "${first.id}") { id name } }`
      );
      expect(data.team.id).toBe(first.id);
      expect(data.team.name).toBe(first.name);
    });

    it('fetches a player by ID', async () => {
      const { data: list } = await gql<{
        players: Connection<{ id: string; firstName: string }>;
      }>('{ players { edges { node { id firstName } } } }');
      const first = list.players.edges[0]!.node;

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
        players: Connection<{
          id: string;
          firstName: string;
          position: { name: string } | null;
          teamHistory: Connection<{ team: { name: string } }>;
          scores: Connection<{ type: string }>;
        }>;
      }>(`{
        players {
          edges { node {
            id firstName
            position { name }
            teamHistory { edges { node { team { name } } } }
            scores { edges { node { type } } }
          } }
        }
      }`);
      const nodes = data.players.edges.map((e) => e.node);
      const withPosition = nodes.find((p) => p.position !== null);
      expect(withPosition).toBeDefined();
      expect(withPosition!.position!.name).toBeTruthy();

      const withHistory = nodes.find((p) => p.teamHistory.edges.length > 0);
      expect(withHistory).toBeDefined();
    });

    it('resolves fixture relations', async () => {
      const { data } = await gql<{
        fixtures: Connection<{
          id: string;
          name: string;
          team: { name: string } | null;
          opponent: { name: string } | null;
          competition: { name: string } | null;
          season: { name: string } | null;
          scores: Connection<{
            type: string;
            minute: number | null;
          }>;
        }>;
      }>(`{
        fixtures {
          edges { node {
            id name
            team { name }
            opponent { name }
            competition { name }
            season { name }
            scores { edges { node { type minute } } }
          } }
        }
      }`);
      const nodes = data.fixtures.edges.map((e) => e.node);
      const withScores = nodes.find((f) => f.scores.edges.length > 0);
      expect(withScores).toBeDefined();
      expect(withScores!.scores.edges[0]!.node).toHaveProperty('type');
    });

    it('resolves competition relations', async () => {
      const { data } = await gql<{
        competitions: Connection<{
          id: string;
          name: string;
          season: { name: string } | null;
          teams: Connection<{ team: { name: string } }>;
        }>;
      }>(`{
        competitions {
          edges { node {
            id name
            season { name }
            teams { edges { node { team { name } } } }
          } }
        }
      }`);
      const nodes = data.competitions.edges.map((e) => e.node);
      const withSeason = nodes.find((c) => c.season !== null);
      expect(withSeason).toBeDefined();
    });
  });

  // ── Where filtering ───────────────────────────────────────────

  describe('where filtering', () => {
    it('filters clubs by name contains', async () => {
      const { data } = await gql<{
        clubs: Connection<{ id: string; name: string }>;
      }>(
        '{ clubs(where: { name: { contains: "RFC" } }) { edges { node { id name } } } }'
      );
      expect(data.clubs.edges.length).toBe(3);
      data.clubs.edges.forEach((edge) => {
        expect(edge.node.name).toContain('RFC');
      });
    });

    it('filters players by exact firstName', async () => {
      const { data } = await gql<{
        players: Connection<{
          id: string;
          firstName: string;
          lastName: string;
        }>;
      }>(
        '{ players(where: { firstName: { equals: "Tom" } }) { edges { node { id firstName lastName } } } }'
      );
      expect(data.players.edges.length).toBe(1);
      expect(data.players.edges[0]!.node.firstName).toBe('Tom');
      expect(data.players.edges[0]!.node.lastName).toBe('Evans');
    });

    it('filters fixtures by isHome', async () => {
      const { data } = await gql<{
        fixtures: Connection<{
          id: string;
          name: string;
          isHome: boolean;
        }>;
      }>(
        '{ fixtures(where: { isHome: { equals: true } }) { edges { node { id name isHome } } } }'
      );
      expect(data.fixtures.edges.length).toBeGreaterThan(0);
      data.fixtures.edges.forEach((edge) => {
        expect(edge.node.isHome).toBe(true);
      });
    });

    it('filters scores by type', async () => {
      const { data } = await gql<{
        scores: Connection<{ id: string; type: string }>;
      }>(
        '{ scores(where: { type: { equals: TRY } }) { edges { node { id type } } } }'
      );
      expect(data.scores.edges.length).toBeGreaterThan(0);
      data.scores.edges.forEach((edge) => {
        expect(edge.node.type).toBe('TRY');
      });
    });

    it('returns empty connection for no matches', async () => {
      const { data } = await gql<{
        clubs: Connection<{ id: string }>;
      }>(
        '{ clubs(where: { name: { equals: "Nonexistent Club" } }) { edges { node { id } } } }'
      );
      expect(data.clubs.edges).toEqual([]);
    });
  });

  // ── Pagination ──────────────────────────────────────────────

  describe('pagination', () => {
    it('paginates with first/after', async () => {
      // Fetch first page
      const { data: page1 } = await gql<{
        teams: Connection<{ id: string; name: string }>;
      }>(
        '{ teams(first: 2) { edges { node { id name } cursor } pageInfo { hasNextPage endCursor } } }'
      );
      expect(page1.teams.edges.length).toBe(2);
      expect(page1.teams.pageInfo.hasNextPage).toBe(true);

      const endCursor = page1.teams.pageInfo.endCursor!;

      // Fetch second page
      const { data: page2 } = await gql<{
        teams: Connection<{ id: string; name: string }>;
      }>(
        `{ teams(first: 2, after: "${endCursor}") { edges { node { id name } cursor } pageInfo { hasNextPage endCursor } } }`
      );
      expect(page2.teams.edges.length).toBeGreaterThanOrEqual(1);

      // No overlap between pages
      const page1Ids = page1.teams.edges.map((e) => e.node.id);
      const page2Ids = page2.teams.edges.map((e) => e.node.id);
      page2Ids.forEach((id) => {
        expect(page1Ids).not.toContain(id);
      });
    });

    it('paginates with where filtering', async () => {
      const { data } = await gql<{
        fixtures: Connection<{
          id: string;
          name: string;
          isHome: boolean;
        }>;
      }>(
        '{ fixtures(first: 1, where: { isHome: { equals: true } }) { edges { node { id name isHome } } pageInfo { hasNextPage } } }'
      );
      expect(data.fixtures.edges.length).toBeLessThanOrEqual(1);
      data.fixtures.edges.forEach((edge) => {
        expect(edge.node.isHome).toBe(true);
      });
    });
  });
});
