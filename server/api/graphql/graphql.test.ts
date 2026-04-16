import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

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

  let blogTypeId: string;
  const blogEntryIds: string[] = [];

  beforeAll(async () => {
    const cookie = await getSessionCookie();
    const existing = await $fetch<any>('/api/content-types?perPage=200', {
      headers: { cookie },
    }).catch(() => ({ items: [] }));
    const already = existing.items?.find?.(
      (c: { identifier: string }) => c.identifier === 'BlogPost'
    );
    if (already) {
      const entries = await $fetch<any>(
        `/api/content-entries?contentTypeId=${already.id}&perPage=200`,
        { headers: { cookie } }
      ).catch(() => ({ items: [] }));
      for (const e of entries.items ?? []) {
        await $fetch<unknown>(`/api/content-entries/${e.id}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
      await $fetch<unknown>(`/api/content-types/${already.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    }

    const type = await $fetch<any>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: 'Blog Post',
        identifier: 'BlogPost',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          { identifier: 'summary', name: 'Summary', type: 'TEXTAREA' },
          {
            identifier: 'publishDate',
            name: 'Publish Date',
            type: 'DATETIME',
          },
          { identifier: 'featured', name: 'Featured', type: 'BOOLEAN' },
          { identifier: 'category', name: 'Category', type: 'TEXT' },
        ],
      },
    });
    blogTypeId = type.id;

    const a = await $fetch<any>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogTypeId,
        data: {
          title: 'Welcome to the Club',
          slug: 'welcome-to-the-club',
          summary: 'A warm welcome',
          publishDate: '2026-02-01T00:00:00.000Z',
          featured: true,
          category: 'community',
        },
        status: 'PUBLISHED',
      },
    });
    blogEntryIds.push(a.id);

    const b = await $fetch<any>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: blogTypeId,
        data: {
          title: 'Second Post',
          slug: 'second-post',
          summary: 'Another one',
          publishDate: '2026-01-01T00:00:00.000Z',
          featured: false,
          category: 'news',
        },
        status: 'PUBLISHED',
      },
    });
    blogEntryIds.push(b.id);
  });

  afterAll(async () => {
    try {
      const cookie = await getSessionCookie();
      for (const id of blogEntryIds) {
        await $fetch<unknown>(`/api/content-entries/${id}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
      if (blogTypeId) {
        await $fetch<unknown>(`/api/content-types/${blogTypeId}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
    } catch {
      // Nuxt test server may already be torn down; ignore.
    }
  });

  describe('authentication', () => {
    // In dev mode, all GraphQL requests are allowed without auth
    // so GraphiQL can introspect. Auth is enforced in production only.
    it('allows unauthenticated requests in dev mode', async () => {
      const response = await $fetch<{ data: { __typename: string } }>(
        '/api/graphql',
        {
          method: 'POST',
          body: { query: '{ __typename }' },
        }
      );
      expect(response.data.__typename).toBe('Query');
    });

    it('accepts requests with a valid API key', async () => {
      const { data } = await gql<{ __typename: string }>('{ __typename }');
      expect(data.__typename).toBe('Query');
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

  describe('Dynamic type filtering', () => {
    it('filters by status', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{ id: string; status: string }>;
      }>(`{
        blogPostList(first: 10, where: { status: { equals: PUBLISHED } }) {
          edges { node { id status } }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(2);
      data.blogPostList.edges.forEach((edge) => {
        expect(edge.node.status).toBe('PUBLISHED');
      });
    });

    it('filters by string field equals', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{ id: string; category: string | null }>;
      }>(`{
        blogPostList(first: 10, where: { category: { equals: "community" } }) {
          edges { node { id category } }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(1);
      expect(data.blogPostList.edges[0]!.node.category).toBe('community');
    });

    it('filters by string field contains', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{ id: string; title: string }>;
      }>(`{
        blogPostList(first: 10, where: { title: { contains: "welcome" } }) {
          edges { node { id title } }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(1);
      expect(data.blogPostList.edges[0]!.node.title).toContain('Welcome');
    });

    it('filters by boolean field equals', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{ id: string; featured: boolean | null }>;
      }>(`{
        blogPostList(first: 10, where: { featured: { equals: true } }) {
          edges { node { id featured } }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(1);
      expect(data.blogPostList.edges[0]!.node.featured).toBe(true);
    });

    it('filters by datetime field range', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{
          id: string;
          publishDate: string | null;
        }>;
      }>(`{
        blogPostList(first: 10, where: { publishDate: { gte: "2026-01-20T00:00:00.000Z" } }) {
          edges { node { id publishDate } }
        }
      }`);
      expect(data.blogPostList.edges.length).toBe(1);
      expect(
        new Date(data.blogPostList.edges[0]!.node.publishDate!).getTime()
      ).toBeGreaterThanOrEqual(new Date('2026-01-20').getTime());
    });

    it('returns empty connection for no filter matches', async () => {
      const { data } = await gql<{
        blogPostList: Connection<{ id: string }>;
      }>(`{
        blogPostList(first: 10, where: { title: { equals: "Nonexistent" } }) {
          edges { node { id } }
        }
      }`);
      expect(data.blogPostList.edges).toEqual([]);
    });
  });

  describe('Dynamic type relations', () => {
    let tagTypeId: string;
    let postTypeId: string;
    let tagEntryId: string;
    let postEntryId: string;

    it('sets up relation test data', async () => {
      const tagType = await $fetch<any>('/api/content-types', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          name: 'Test Tag',
          identifier: 'TestTag',
          fields: [
            {
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          ],
        },
      });
      tagTypeId = tagType.id;

      const postType = await $fetch<any>('/api/content-types', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          name: 'Test Post',
          identifier: 'TestPost',
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'mainTag',
              name: 'Main Tag',
              type: 'RELATION',
              options: { targetContentTypeIds: [tagTypeId] },
            },
            {
              identifier: 'tags',
              name: 'Tags',
              type: 'MULTIRELATION',
              options: { targetContentTypeIds: [tagTypeId] },
            },
          ],
        },
      });
      postTypeId = postType.id;

      const tag1 = await $fetch<any>('/api/content-entries', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: tagTypeId,
          data: { name: 'GraphQL', slug: 'graphql' },
          status: 'PUBLISHED',
        },
      });
      tagEntryId = tag1.id;

      const tag2 = await $fetch<any>('/api/content-entries', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: tagTypeId,
          data: { name: 'TypeScript', slug: 'typescript' },
          status: 'PUBLISHED',
        },
      });

      const post = await $fetch<any>('/api/content-entries', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: postTypeId,
          data: {
            title: 'Relation Test Post',
            mainTag: { contentTypeId: tagTypeId, entryId: tagEntryId },
            tags: [
              { contentTypeId: tagTypeId, entryId: tagEntryId },
              { contentTypeId: tagTypeId, entryId: tag2.id },
            ],
          },
          status: 'PUBLISHED',
        },
      });
      postEntryId = post.id;
    });

    it('resolves RELATION field to target type', async () => {
      const { data } = await gql<{
        testPost: {
          id: string;
          title: string;
          mainTag: { id: string; name: string; contentType: string } | null;
        } | null;
      }>(`{
        testPost(id: "${postEntryId}") {
          id title
          mainTag { ... on TestTag { id name contentType } }
        }
      }`);
      expect(data.testPost).not.toBeNull();
      expect(data.testPost!.mainTag).not.toBeNull();
      expect(data.testPost!.mainTag!.name).toBe('GraphQL');
      expect(data.testPost!.mainTag!.contentType).toBe('TestTag');
    });

    it('resolves MULTIRELATION field as connection', async () => {
      const { data } = await gql<{
        testPost: {
          id: string;
          tags: Connection<{ id: string; name: string }>;
        } | null;
      }>(`{
        testPost(id: "${postEntryId}") {
          id
          tags(first: 10) {
            edges { node { ... on TestTag { id name } } }
          }
        }
      }`);
      expect(data.testPost).not.toBeNull();
      expect(data.testPost!.tags.edges.length).toBe(2);
      const names = data.testPost!.tags.edges.map((e) => e.node.name);
      expect(names).toContain('GraphQL');
      expect(names).toContain('TypeScript');
    });

    it('cleans up relation test data', async () => {
      await $fetch<unknown>(`/api/content-entries/${postEntryId}`, {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
      const tagEntries = await $fetch<any>(
        `/api/content-entries?contentTypeId=${tagTypeId}`,
        {
          headers: { Cookie: await getSessionCookie() },
        }
      );
      for (const entry of tagEntries.items) {
        await $fetch<unknown>(`/api/content-entries/${entry.id}`, {
          method: 'DELETE',
          headers: { Cookie: await getSessionCookie() },
        });
      }
      await $fetch<unknown>(`/api/content-types/${postTypeId}`, {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
      await $fetch<unknown>(`/api/content-types/${tagTypeId}`, {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
    });
  });

  describe('Schema rebuild on content type changes', () => {
    it('rebuilds schema when a new content type is created', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<any>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Schema Test Type',
          identifier: 'SchemaTestType',
          fields: [
            {
              identifier: 'label',
              name: 'Label',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const { data, errors } = await gql<{
        schemaTestTypeList: Connection<{ id: string }>;
      }>('{ schemaTestTypeList(first: 1) { edges { node { id } } } }');
      expect(errors).toBeUndefined();
      expect(data.schemaTestTypeList.edges).toEqual([]);

      await $fetch<unknown>(`/api/content-types/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
    });

    it('rebuilds schema when a field is added', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<any>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Field Add Test',
          identifier: 'FieldAddTest',
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      await $fetch(`/api/content-types/${created.id}/fields`, {
        method: 'POST',
        headers: { cookie },
        body: { identifier: 'description', name: 'Description', type: 'TEXT' },
      });

      const entry = await $fetch<any>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: created.id,
          data: { title: 'Test', description: 'A description' },
          status: 'DRAFT',
        },
      });

      const { data } = await gql<{
        fieldAddTest: {
          title: string;
          description: string | null;
        } | null;
      }>(`{ fieldAddTest(id: "${entry.id}") { title description } }`);
      expect(data.fieldAddTest).not.toBeNull();
      expect(data.fieldAddTest!.description).toBe('A description');

      await $fetch<unknown>(`/api/content-entries/${entry.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      await $fetch<unknown>(`/api/content-types/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
    });

    it('rebuilds schema when a content type is deleted', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<any>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Delete Test',
          identifier: 'DeleteTest',
          fields: [
            {
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const { data: before } = await gql<{
        deleteTestList: Connection<{ id: string }>;
      }>('{ deleteTestList(first: 1) { edges { node { id } } } }');
      expect(before.deleteTestList).toBeDefined();

      await $fetch<unknown>(`/api/content-types/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });

      const result = await gql<any>(
        '{ deleteTestList(first: 1) { edges { node { id } } } }'
      );
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Cross-type contentEntryList query', () => {
    it('returns entries from all dynamic types', async () => {
      const { data } = await gql<{
        contentEntryList: Connection<{
          id: string;
          contentType: string;
          status: string;
        }>;
      }>(`{
        contentEntryList(first: 50) {
          edges {
            node {
              id contentType status
              ... on BlogPost { title slug }
            }
          }
        }
      }`);
      expect(data.contentEntryList.edges.length).toBeGreaterThanOrEqual(2);
      const types = new Set(
        data.contentEntryList.edges.map((e) => e.node.contentType)
      );
      expect(types.has('BlogPost')).toBe(true);
    });

    it('filters contentEntryList by contentType', async () => {
      const { data } = await gql<{
        contentEntryList: Connection<{
          id: string;
          contentType: string;
        }>;
      }>(`{
        contentEntryList(first: 50, where: { contentType: { equals: "BlogPost" } }) {
          edges { node { id contentType } }
        }
      }`);
      data.contentEntryList.edges.forEach((edge) => {
        expect(edge.node.contentType).toBe('BlogPost');
      });
    });

    it('filters contentEntryList by status', async () => {
      const { data } = await gql<{
        contentEntryList: Connection<{
          id: string;
          status: string;
        }>;
      }>(`{
        contentEntryList(first: 50, where: { status: { equals: PUBLISHED } }) {
          edges { node { id status } }
        }
      }`);
      data.contentEntryList.edges.forEach((edge) => {
        expect(edge.node.status).toBe('PUBLISHED');
      });
    });
  });
});
