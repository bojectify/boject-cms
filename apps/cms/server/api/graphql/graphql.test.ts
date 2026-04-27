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
    const existing = await $fetch<{
      items: Array<{ id: string; identifier: string }>;
    }>('/api/content-types?perPage=200', {
      headers: { cookie },
    }).catch(() => ({ items: [] }));
    const already = existing.items?.find?.(
      (c: { identifier: string }) => c.identifier === 'BlogPost'
    );
    if (already) {
      const entries = await $fetch<{ items: Array<{ id: string }> }>(
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

    const type = await $fetch<{ id: string }>('/api/content-types', {
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

    const a = await $fetch<{ id: string }>('/api/content-entries', {
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

    const b = await $fetch<{ id: string }>('/api/content-entries', {
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
      const tagType = await $fetch<{ id: string }>('/api/content-types', {
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

      const postType = await $fetch<{ id: string }>('/api/content-types', {
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

      const tag1 = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: tagTypeId,
          data: { name: 'GraphQL', slug: 'graphql' },
          status: 'PUBLISHED',
        },
      });
      tagEntryId = tag1.id;

      const tag2 = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: tagTypeId,
          data: { name: 'TypeScript', slug: 'typescript' },
          status: 'PUBLISHED',
        },
      });

      const post = await $fetch<{ id: string }>('/api/content-entries', {
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
      const tagEntries = await $fetch<{ items: Array<{ id: string }> }>(
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
      const created = await $fetch<{ id: string }>('/api/content-types', {
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
      const created = await $fetch<{ id: string }>('/api/content-types', {
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

      // GraphQL only serves PUBLISHED versions, so create as PUBLISHED
      const entry = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: created.id,
          data: { title: 'Test', description: 'A description' },
          status: 'PUBLISHED',
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
      const created = await $fetch<{ id: string }>('/api/content-types', {
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

      const result = await gql<unknown>(
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

  describe('Versioning visibility in GraphQL', () => {
    it('draft entries are not visible in GraphQL queries', async () => {
      const cookie = await getSessionCookie();

      // Create a draft-only entry
      const draftEntry = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: blogTypeId,
          data: {
            title: `GQL Draft ${Date.now()}`,
            slug: `gql-draft-${Date.now()}`,
            summary: 'Should be invisible',
          },
          status: 'DRAFT',
        },
      });

      // GraphQL single-item lookup should return null for draft entry
      const { data } = await gql<{
        blogPost: { id: string } | null;
      }>(`{ blogPost(id: "${draftEntry.id}") { id } }`);
      expect(data.blogPost).toBeNull();

      // Clean up
      await $fetch<unknown>(`/api/content-entries/${draftEntry.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
    });

    it('after publishing a CHANGED version, GraphQL serves the updated data', async () => {
      const cookie = await getSessionCookie();
      const ts = Date.now();

      // Create and publish an entry
      const entry = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: blogTypeId,
          data: {
            title: `GQL Version ${ts}`,
            slug: `gql-version-${ts}`,
            summary: 'Original published',
          },
          status: 'PUBLISHED',
        },
      });

      // Verify GraphQL sees the original published version
      const { data: before } = await gql<{
        blogPost: { id: string; summary: string | null } | null;
      }>(`{ blogPost(id: "${entry.id}") { id summary } }`);
      expect(before.blogPost).not.toBeNull();
      expect(before.blogPost!.summary).toBe('Original published');

      // Save a draft edit (creates CHANGED version)
      await $fetch(`/api/content-entries/${entry.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          data: {
            title: `GQL Version ${ts}`,
            slug: `gql-version-${ts}`,
            summary: 'Draft changes',
          },
        },
      });

      // GraphQL should still see the PUBLISHED version, not the CHANGED
      const { data: during } = await gql<{
        blogPost: { id: string; summary: string | null } | null;
      }>(`{ blogPost(id: "${entry.id}") { id summary } }`);
      expect(during.blogPost).not.toBeNull();
      expect(during.blogPost!.summary).toBe('Original published');

      // Publish the CHANGED version
      await $fetch(`/api/content-entries/${entry.id}`, {
        method: 'PUT',
        headers: { cookie },
        body: { status: 'PUBLISHED' },
      });

      // GraphQL should now serve the updated content
      const { data: after } = await gql<{
        blogPost: { id: string; summary: string | null } | null;
      }>(`{ blogPost(id: "${entry.id}") { id summary } }`);
      expect(after.blogPost).not.toBeNull();
      expect(after.blogPost!.summary).toBe('Draft changes');

      // Clean up
      await $fetch<unknown>(`/api/content-entries/${entry.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
    });
  });

  describe('RICHTEXT references', () => {
    let articleTypeId: string;
    let tagTypeId: string;
    let tag1Id: string;
    let tag2Id: string;
    let articleEntryId: string;

    it('sets up richtext-references test data', async () => {
      const cookie = await getSessionCookie();

      // Cleanup any prior run
      const existing = await $fetch<{
        items: Array<{ id: string; identifier: string }>;
      }>('/api/content-types?perPage=200', { headers: { cookie } }).catch(
        () => ({ items: [] })
      );
      for (const id of ['RtArticle', 'RtTag']) {
        const ct = existing.items?.find?.((c) => c.identifier === id);
        if (!ct) continue;
        const entries = await $fetch<{ items: Array<{ id: string }> }>(
          `/api/content-entries?contentTypeId=${ct.id}&perPage=200`,
          { headers: { cookie } }
        ).catch(() => ({ items: [] }));
        for (const e of entries.items ?? []) {
          await $fetch<unknown>(`/api/content-entries/${e.id}`, {
            method: 'DELETE',
            headers: { cookie },
          }).catch(() => {});
        }
        await $fetch<unknown>(`/api/content-types/${ct.id}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }

      // Create RtTag content type
      const tagType = await $fetch<{ id: string }>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Rt Tag',
          identifier: 'RtTag',
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          ],
        },
      });
      tagTypeId = tagType.id;

      const tag1 = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: tagTypeId,
          data: { title: 'News', slug: 'news' },
          status: 'PUBLISHED',
        },
      });
      tag1Id = tag1.id;
      const tag2 = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: tagTypeId,
          data: { title: 'Sport', slug: 'sport' },
          status: 'PUBLISHED',
        },
      });
      tag2Id = tag2.id;

      // Create RtArticle with a RICHTEXT body that allows RtTag embeds
      const articleType = await $fetch<{ id: string }>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Rt Article',
          identifier: 'RtArticle',
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'body',
              name: 'Body',
              type: 'RICHTEXT',
              options: { targetContentTypeIds: [tagTypeId] },
            },
          ],
        },
      });
      articleTypeId = articleType.id;

      const article = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: articleTypeId,
          data: {
            title: 'Hello World',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'See ' },
                    {
                      type: 'cmsEmbed',
                      attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                    },
                    { type: 'text', text: ' and ' },
                    {
                      type: 'cmsEmbed',
                      attrs: { contentTypeId: tagTypeId, entryId: tag2Id },
                    },
                    { type: 'text', text: '.' },
                  ],
                },
                {
                  // Same tag1 referenced again — must be deduplicated
                  type: 'paragraph',
                  content: [
                    {
                      type: 'cmsEmbed',
                      attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                    },
                  ],
                },
              ],
            },
          },
          status: 'PUBLISHED',
        },
      });
      articleEntryId = article.id;

      expect(tagTypeId).toBeTruthy();
      expect(articleTypeId).toBeTruthy();
      expect(tag1Id).toBeTruthy();
      expect(tag2Id).toBeTruthy();
      expect(articleEntryId).toBeTruthy();
    });

    it('returns json + deduplicated references with fragment-narrowed types', async () => {
      const res = await gql<{
        rtArticle: {
          id: string;
          body: {
            json: { type: string };
            references: Array<{
              __typename: string;
              id: string;
              slug?: string;
            }>;
          };
        };
      }>(`
        query {
          rtArticle(id: "${articleEntryId}") {
            id
            body {
              json
              references {
                __typename
                id
                ... on RtTag { slug }
              }
            }
          }
        }
      `);

      expect(res.errors).toBeUndefined();
      expect(res.data.rtArticle.body.json.type).toBe('doc');

      const refs = res.data.rtArticle.body.references;
      expect(refs).toHaveLength(2);
      const sortedSlugs = refs.map((r) => r.slug).sort();
      expect(sortedSlugs).toEqual(['news', 'sport']);
      for (const r of refs) {
        expect(r.__typename).toBe('RtTag');
      }
    });

    it('returns an empty references array for a body with no references', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: articleTypeId,
          data: {
            title: 'Plain',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'plain' }],
                },
              ],
            },
          },
          status: 'PUBLISHED',
        },
      });

      const res = await gql<{
        rtArticle: { body: { references: unknown[] } };
      }>(`
        query {
          rtArticle(id: "${created.id}") {
            body { references { __typename id } }
          }
        }
      `);
      expect(res.errors).toBeUndefined();
      expect(res.data.rtArticle.body.references).toEqual([]);

      await $fetch<unknown>(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    });

    it('drops references whose target has no PUBLISHED version', async () => {
      const cookie = await getSessionCookie();
      // Create a draft-only tag
      const draftTag = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: tagTypeId,
          data: { title: 'Draft', slug: 'draft' },
          // status defaults to DRAFT
        },
      });

      const article = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: articleTypeId,
          data: {
            title: 'WithDraftRef',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'cmsEmbed',
                      attrs: {
                        contentTypeId: tagTypeId,
                        entryId: draftTag.id,
                      },
                    },
                  ],
                },
              ],
            },
          },
          status: 'PUBLISHED',
        },
      });

      const res = await gql<{
        rtArticle: { body: { references: unknown[] } };
      }>(`
        query {
          rtArticle(id: "${article.id}") {
            body { references { __typename id } }
          }
        }
      `);
      expect(res.errors).toBeUndefined();
      expect(res.data.rtArticle.body.references).toEqual([]);

      await $fetch<unknown>(`/api/content-entries/${article.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
      await $fetch<unknown>(`/api/content-entries/${draftTag.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    });

    it('combines cmsEmbed nodes and cmsLink marks in references with cross-source dedup', async () => {
      const cookie = await getSessionCookie();

      // Locate the body field id and patch its options to also allow link targets to RtTag.
      const ct = await $fetch<{
        fields: Array<{ id: string; identifier: string }>;
      }>(`/api/content-types/${articleTypeId}`, { headers: { cookie } });
      const bodyField = ct.fields.find((f) => f.identifier === 'body');
      expect(bodyField).toBeTruthy();
      // NOTE: this PUT permanently mutates the body field's options for the
      // rest of this describe block (until the cleanup `it` deletes the type).
      // Subsequent tests in this describe inherit linkTargetContentTypeIds:
      // [tagTypeId]. If you add a test that needs the field WITHOUT a link
      // allow-list, insert it BEFORE this `it` or reset the option here.
      await $fetch<unknown>(
        `/api/content-types/${articleTypeId}/fields/${bodyField!.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            name: 'Body',
            required: false,
            options: {
              targetContentTypeIds: [tagTypeId],
              linkTargetContentTypeIds: [tagTypeId],
            },
          },
        }
      );

      const article = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: articleTypeId,
          data: {
            title: 'Mixed',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    // Embed of tag1
                    {
                      type: 'cmsEmbed',
                      attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                    },
                    { type: 'text', text: ' and ' },
                    // Link wrapping text, also targeting tag1 — must dedup
                    {
                      type: 'text',
                      text: 'see news',
                      marks: [
                        {
                          type: 'cmsLink',
                          attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                        },
                      ],
                    },
                    { type: 'text', text: ' or ' },
                    // Link to tag2
                    {
                      type: 'text',
                      text: 'sport',
                      marks: [
                        {
                          type: 'cmsLink',
                          attrs: { contentTypeId: tagTypeId, entryId: tag2Id },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          status: 'PUBLISHED',
        },
      });

      const res = await gql<{
        rtArticle: {
          body: {
            json: {
              content: Array<{
                content: Array<{
                  marks?: Array<{
                    type: string;
                    attrs: Record<string, unknown>;
                  }>;
                }>;
              }>;
            };
            references: Array<{
              __typename: string;
              id: string;
              slug?: string;
            }>;
          };
        };
      }>(`
        query {
          rtArticle(id: "${article.id}") {
            body {
              json
              references {
                __typename
                id
                ... on RtTag { slug }
              }
            }
          }
        }
      `);
      expect(res.errors).toBeUndefined();

      const refs = res.data.rtArticle.body.references;
      expect(refs).toHaveLength(2);
      const slugs = refs.map((r) => r.slug).sort();
      expect(slugs).toEqual(['news', 'sport']);

      // Confirm cmsLink marks in the round-tripped json carry the
      // server-stamped contentTypeIdentifier — proves the enrich pipeline
      // actually fired during POST and the value survives the GraphQL fetch.
      const cmsLinkMarks: Array<{ attrs: Record<string, unknown> }> = [];
      for (const para of res.data.rtArticle.body.json.content) {
        for (const child of para.content) {
          for (const mark of child.marks ?? []) {
            if (mark.type === 'cmsLink') {
              cmsLinkMarks.push({ attrs: mark.attrs });
            }
          }
        }
      }
      expect(cmsLinkMarks).toHaveLength(2);
      for (const m of cmsLinkMarks) {
        expect(m.attrs.contentTypeIdentifier).toBe('RtTag');
      }

      // Cleanup: delete this test's article so the wildcard sweep at the end is faster
      await $fetch<unknown>(`/api/content-entries/${article.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    });

    it('rejects entry creation with a cmsLink mark targeting a disallowed type', async () => {
      const cookie = await getSessionCookie();

      // Create a sibling content type that the body field does NOT allow as a link target.
      const other = await $fetch<{ id: string }>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Rt Other',
          identifier: 'RtOther',
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

      const otherEntry = await $fetch<{ id: string }>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: other.id,
          data: { title: 'Other' },
          status: 'PUBLISHED',
        },
      });

      const create = $fetch<unknown>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: articleTypeId,
          data: {
            title: 'Disallowed',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'click',
                      marks: [
                        {
                          type: 'cmsLink',
                          attrs: {
                            contentTypeId: other.id,
                            entryId: otherEntry.id,
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      });

      await expect(create).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: expect.stringContaining(
          'Entry link references a content type that is not allowed'
        ),
      });

      // Cleanup
      await $fetch<unknown>(`/api/content-entries/${otherEntry.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
      await $fetch<unknown>(`/api/content-types/${other.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    });

    it('cleans up richtext-references test data', async () => {
      const cookie = await getSessionCookie();
      for (const ctId of [articleTypeId, tagTypeId]) {
        const entries = await $fetch<{ items: Array<{ id: string }> }>(
          `/api/content-entries?contentTypeId=${ctId}&perPage=200`,
          { headers: { cookie } }
        ).catch(() => ({ items: [] }));
        for (const e of entries.items ?? []) {
          await $fetch<unknown>(`/api/content-entries/${e.id}`, {
            method: 'DELETE',
            headers: { cookie },
          }).catch(() => {});
        }
        await $fetch<unknown>(`/api/content-types/${ctId}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
    });
  });
});
