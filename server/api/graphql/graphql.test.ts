import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type GqlResponse<T> = { data: T; errors?: { message: string }[] };

function gql<T>(query: string) {
  return $fetch<GqlResponse<T>>('/api/graphql', {
    method: 'POST',
    body: { query },
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
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

  // ── Author queries ──────────────────────────────────────────

  describe('Author queries', () => {
    it('lists authors', async () => {
      const { data } = await gql<{
        authors: Connection<{
          id: string;
          name: string;
          slug: string;
          bio: string | null;
        }>;
      }>(`{
        authors(first: 10) {
          edges { node { id name slug bio } }
        }
      }`);
      expect(data.authors.edges.length).toBeGreaterThanOrEqual(2);
    });

    it('fetches single author with socialLinks', async () => {
      const { data: list } = await gql<{
        authors: Connection<{ id: string }>;
      }>(`{
        authors(first: 1) { edges { node { id } } }
      }`);
      const id = list.authors.edges[0]!.node.id;
      const { data } = await gql<{
        author: {
          id: string;
          name: string;
          socialLinks: { id: string; platform: string; url: string }[];
        };
      }>(`{
        author(id: "${id}") { id name socialLinks { id platform url } }
      }`);
      expect(data.author.id).toBe(id);
      expect(data.author.socialLinks).toBeDefined();
    });
  });

  // ── Tag queries ─────────────────────────────────────────────

  describe('Tag queries', () => {
    it('lists tags', async () => {
      const { data } = await gql<{
        tags: Connection<{ id: string; name: string; slug: string }>;
      }>(`{
        tags(first: 10) {
          edges { node { id name slug } }
        }
      }`);
      expect(data.tags.edges.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Article queries ─────────────────────────────────────────

  describe('Article queries', () => {
    it('lists articles', async () => {
      const { data } = await gql<{
        articles: Connection<{
          id: string;
          title: string;
          slug: string;
          summary: string | null;
        }>;
      }>(`{
        articles(first: 10) {
          edges { node { id title slug summary } }
        }
      }`);
      expect(data.articles.edges.length).toBeGreaterThanOrEqual(3);
    });

    it('fetches single article with relations', async () => {
      const { data: list } = await gql<{
        articles: Connection<{ id: string }>;
      }>(`{
        articles(first: 1) { edges { node { id } } }
      }`);
      const id = list.articles.edges[0]!.node.id;
      const { data } = await gql<{
        article: {
          id: string;
          title: string;
          author: { id: string; name: string } | null;
          tags: Connection<{ id: string; name: string }>;
        };
      }>(`{
        article(id: "${id}") {
          id title
          author { id name }
          tags(first: 10) { edges { node { id name } } }
        }
      }`);
      expect(data.article.id).toBe(id);
    });

    it('filters articles by status', async () => {
      const { data } = await gql<{
        articles: Connection<{ id: string; title: string; status: string }>;
      }>(`{
        articles(first: 10, where: { status: { equals: DRAFT } }) {
          edges { node { id title status } }
        }
      }`);
      expect(data.articles.edges.length).toBeGreaterThanOrEqual(1);
      data.articles.edges.forEach((edge) => {
        expect(edge.node.status).toBe('DRAFT');
      });
    });
  });

  describe('Link queries', () => {
    it('fetches links with internalLink union', async () => {
      const { data } = await gql<{
        links: Connection<{
          id: string;
          label: string;
          url: string | null;
          openInNewTab: boolean;
          internalLink: {
            __typename: string;
            slug?: string;
            title?: string;
          } | null;
        }>;
      }>(`{
        links(first: 10) {
          edges {
            node {
              id
              label
              url
              openInNewTab
              internalLink {
                __typename
                ... on Article {
                  slug
                  title
                }
              }
            }
          }
        }
      }`);
      expect(data.links.edges.length).toBeGreaterThanOrEqual(1);
      const node = data.links.edges[0]!.node;
      expect(node.label).toBeDefined();
    });

    it('fetches a single link by id', async () => {
      const { data: listData } = await gql<{
        links: Connection<{ id: string }>;
      }>(`{
        links(first: 1) { edges { node { id } } }
      }`);
      const id = listData.links.edges[0]!.node.id;
      const { data } = await gql<{
        link: {
          id: string;
          label: string;
          internalLink: { __typename: string } | null;
        };
      }>(`{
        link(id: "${id}") {
          id
          label
          internalLink {
            __typename
          }
        }
      }`);
      expect(data.link.id).toBe(id);
    });
  });

  describe('Navigation queries', () => {
    it('fetches navigations with nested items and links', async () => {
      const { data } = await gql<{
        navigations: Connection<{
          id: string;
          name: string;
          items: Connection<{
            order: number;
            link: {
              label: string;
              url: string | null;
              internalLink: { __typename: string; slug?: string } | null;
            };
            children: Connection<{
              order: number;
              link: { label: string; url: string | null };
            }>;
          }>;
        }>;
      }>(`{
        navigations(first: 1) {
          edges {
            node {
              id
              name
              items(first: 50) {
                edges {
                  node {
                    order
                    link {
                      label
                      url
                      internalLink {
                        __typename
                        ... on Article {
                          slug
                        }
                      }
                    }
                    children(first: 20) {
                      edges {
                        node {
                          order
                          link { label url }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`);
      expect(data.navigations.edges.length).toBeGreaterThanOrEqual(1);
      const nav = data.navigations.edges[0]!.node;
      expect(nav.name).toBeDefined();
      expect(nav.items.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('fetches a single navigation by id', async () => {
      const { data: listData } = await gql<{
        navigations: Connection<{ id: string }>;
      }>(`{
        navigations(first: 1) { edges { node { id } } }
      }`);
      const id = listData.navigations.edges[0]!.node.id;
      const { data } = await gql<{
        navigation: { id: string; name: string };
      }>(`{
        navigation(id: "${id}") {
          id
          name
        }
      }`);
      expect(data.navigation.id).toBe(id);
    });
  });

  // ── Authentication ──────────────────────────────────────────

  describe('authentication', () => {
    it('rejects requests without an API key', async () => {
      const response = await $fetch<{ error: string }>('/api/graphql', {
        method: 'POST',
        body: { query: '{ teams { edges { node { id } } } }' },
        ignoreResponseError: true,
      });
      expect(response.error).toBe('Missing Authorization header');
    });

    it('rejects requests with an invalid API key', async () => {
      const response = await $fetch<{ error: string }>('/api/graphql', {
        method: 'POST',
        body: { query: '{ teams { edges { node { id } } } }' },
        headers: { Authorization: 'Bearer boject_invalid_key' },
        ignoreResponseError: true,
      });
      expect(response.error).toBe('Invalid API key');
    });

    it('accepts requests with a valid API key', async () => {
      const { data } = await gql<{
        teams: { edges: { node: { id: string } }[] };
      }>('{ teams { edges { node { id } } } }');
      expect(data.teams.edges).toBeInstanceOf(Array);
    });
  });

  describe('Dynamic content type queries', () => {
    it('queries a dynamic type list with typed fields', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{
          id: string;
          contentType: string;
          status: string;
          title: string;
          slug: string;
          summary: string | null;
          publishDate: string | null;
          featured: boolean | null;
          category: string | null;
        }>;
      }>(`{
        blogPostList(first: 10) {
          edges {
            node {
              id contentType status title slug summary
              publishDate featured category
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(2);
      const node = data.blogPostList.edges[0]!.node;
      expect(node.contentType).toBe('BlogPost');
      expect(node.title).toBeTruthy();
      expect(node.status).toBe('PUBLISHED');
    });

    it('fetches a single dynamic entry by ID', async () => {
      const { data: list } = await gql<{
        blogPostList: Connection<{ id: string }>;
      }>('{ blogPostList(first: 1) { edges { node { id } } } }');
      const id = list.blogPostList.edges[0]!.node.id;

      const { data } = await gql<{
        blogPost: { id: string; title: string; contentType: string } | null;
      }>(`{ blogPost(id: "${id}") { id title contentType } }`);
      expect(data.blogPost).not.toBeNull();
      expect(data.blogPost!.id).toBe(id);
      expect(data.blogPost!.contentType).toBe('BlogPost');
    });

    it('fetches a single dynamic entry by slug', async () => {
      const { data } = await gql<{
        blogPostBySlug: { id: string; title: string; slug: string } | null;
      }>('{ blogPostBySlug(slug: "welcome-to-the-club") { id title slug } }');
      expect(data.blogPostBySlug).not.toBeNull();
      expect(data.blogPostBySlug!.slug).toBe('welcome-to-the-club');
      expect(data.blogPostBySlug!.title).toBe('Welcome to the Club');
    });

    it('returns null for non-existent ID on dynamic type', async () => {
      const { data } = await gql<{ blogPost: null }>(
        '{ blogPost(id: "00000000-0000-0000-0000-000000000000") { id } }'
      );
      expect(data.blogPost).toBeNull();
    });

    it('returns null for non-existent slug on dynamic type', async () => {
      const { data } = await gql<{ blogPostBySlug: null }>(
        '{ blogPostBySlug(slug: "does-not-exist") { id } }'
      );
      expect(data.blogPostBySlug).toBeNull();
    });

    it('paginates dynamic type list with first/after', async () => {
      const { data: page1 } = await gql<{
        blogPostList: Connection<{ id: string; title: string }>;
      }>(`{
        blogPostList(first: 1) {
          edges { node { id title } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`);
      expect(page1.blogPostList.edges.length).toBe(1);
      expect(page1.blogPostList.pageInfo.hasNextPage).toBe(true);

      const cursor = page1.blogPostList.pageInfo.endCursor!;
      const { data: page2 } = await gql<{
        blogPostList: Connection<{ id: string; title: string }>;
      }>(`{
        blogPostList(first: 1, after: "${cursor}") {
          edges { node { id title } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`);
      expect(page2.blogPostList.edges.length).toBe(1);
      expect(page2.blogPostList.edges[0]!.node.id).not.toBe(
        page1.blogPostList.edges[0]!.node.id
      );
    });
  });
});
