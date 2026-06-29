import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { createStorage } from 'unstorage';
import redisDriver from 'unstorage/drivers/redis';
import Redis from 'ioredis';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { getTestRedisUrl } from '../../../test/redisUrl';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';
import { createTaggedCache } from '../../utils/taggedCache';
import { syncToCacheInvalidation } from '../../utils/syncToCacheInvalidation';

// End-to-end acceptance for the #260 GraphQL response cache. A real Nuxt server
// (booted by @nuxt/test-utils in a SEPARATE process) proves HIT/MISS, that an
// errored query is never served from cache, the Option B opt-in boundary, and —
// closing the loop with #261 — that updating an Author invalidates a cached
// query that traversed `article { author { name } }`.
//
// The booted server caches into the test Redis (DB 1, set by vitest.config.ts).
// We CANNOT import the server's taggedCache singleton (it resolves Nitro deps
// absent in this process), so the invalidation test builds its OWN
// createTaggedCache over the SAME REDIS_URL to simulate the #261 subscriber.
// The server's `cache:` unstorage mount strips its prefix before the driver, so
// a root-mounted driver here lands on the same physical Redis key — a layout
// mismatch would surface loudly as a still-HIT on the final assertion.

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';
const bearer = { Authorization: `Bearer ${TEST_API_KEY}` };

let cookie: string;

async function login(): Promise<string> {
  if (cookie) return cookie;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  cookie = res.headers.getSetCookie().join('; ');
  return cookie;
}

async function session<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: await login() },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

type GqlBody = {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
};

/**
 * POST a query to /api/graphql and surface the X-Cache header + parsed body.
 * `optIn` toggles the Option B header: under VITEST a request is cache-eligible
 * ONLY when it carries `x-boject-test-cache: 1` (see graphql.ts).
 */
async function gqlRaw(
  query: string,
  optIn = true
): Promise<{ cache: string | null; body: GqlBody }> {
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...bearer,
      ...(optIn ? { 'x-boject-test-cache': '1' } : {}),
    },
    body: JSON.stringify({ query }),
  });
  return {
    cache: res.headers.get('x-cache'),
    body: (await res.json()) as GqlBody,
  };
}

describe('GraphQL response cache (#260)', async () => {
  await setup({ dev: true });

  // Unique suffix so identifiers + cache keys never collide across runs/files.
  const sfx = Math.random().toString(36).slice(2, 8);
  const AUTHOR = `Author${sfx}`;
  const ARTICLE = `Article${sfx}`;
  const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  let authorId = '';

  beforeAll(async () => {
    // Author content type: ENTRY_TITLE only.
    const author = await session<{ id: string }>('/api/content-types', {
      name: `Author ${sfx}`,
      identifier: AUTHOR,
      fields: [
        {
          name: 'Name',
          identifier: 'name',
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
        },
      ],
    });
    const authorTypeId = author.id;

    // Article content type: ENTRY_TITLE + single-target RELATION -> Author.
    const article = await session<{ id: string }>('/api/content-types', {
      name: `Article ${sfx}`,
      identifier: ARTICLE,
      fields: [
        {
          name: 'Title',
          identifier: 'title',
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
        },
        {
          name: 'Author',
          identifier: 'author',
          type: FIELD_TYPES.RELATION,
          options: { targetContentTypeIds: [authorTypeId] },
        },
      ],
    });
    const articleTypeId = article.id;

    // Create + publish an Author in one POST (GraphQL serves PUBLISHED only).
    const a = await session<{ id: string }>('/api/entries', {
      contentTypeId: authorTypeId,
      data: { name: `Ada ${sfx}` },
      status: CONTENT_STATUSES.PUBLISHED,
    });
    authorId = a.id;

    // Create + publish an Article referencing the Author.
    await session<{ id: string }>('/api/entries', {
      contentTypeId: articleTypeId,
      data: {
        title: `Headline ${sfx}`,
        author: { contentTypeId: authorTypeId, entryId: authorId },
      },
      status: CONTENT_STATUSES.PUBLISHED,
    });
  });

  it('serves the second identical query from cache (MISS then HIT)', async () => {
    const query = `{ ${camel(ARTICLE)}List { edges { node { id } } } }`;

    const first = await gqlRaw(query);
    expect(first.cache).toBe('MISS');
    // The query genuinely returned the seeded article (not a vacuous result).
    const firstList = first.body.data?.[`${camel(ARTICLE)}List`] as {
      edges: unknown[];
    };
    expect(firstList.edges.length).toBeGreaterThanOrEqual(1);

    const second = await gqlRaw(query);
    expect(second.cache).toBe('HIT');
    expect(second.body).toEqual(first.body);
  });

  it('never serves an errored query from cache', async () => {
    // `{ thisFieldDoesNotExist }` is a VALIDATION error — rejected before the
    // execute phase, so the plugin's onExecute/onExecuteDone never run and NO
    // X-Cache header is set (the header is null, not 'MISS'). The contract is
    // "an errored query is never served from cache": the error surfaces and the
    // response is never a cached HIT, on either request.
    const bad = await gqlRaw('{ thisFieldDoesNotExist }');
    expect(bad.body.errors?.length).toBeGreaterThan(0);
    expect(bad.cache).not.toBe('HIT');

    const again = await gqlRaw('{ thisFieldDoesNotExist }');
    expect(again.body.errors?.length).toBeGreaterThan(0);
    expect(again.cache).not.toBe('HIT'); // never promoted to a cached HIT
  });

  it('updating an Author invalidates a cached query that traversed it', async () => {
    // A list query that traverses the RELATION into the Author. The relation
    // resolver passes the resolved Author through flattenToShape, the entry-tag
    // collector chokepoint, so this cached response is tagged with the Author's
    // entry + content-type tags as well as the Article's.
    const query = `{
      ${camel(ARTICLE)}List {
        edges { node { id author { ... on ${AUTHOR} { id name } } } }
      }
    }`;

    const first = await gqlRaw(query);
    expect(first.cache).toBe('MISS');
    // Prove the traversal actually surfaced the Author (otherwise no Author tag
    // would be harvested and this test would be vacuous).
    const firstList = first.body.data?.[`${camel(ARTICLE)}List`] as {
      edges: { node: { author: { name: string } | null } }[];
    };
    expect(firstList.edges[0]?.node.author?.name).toBe(`Ada ${sfx}`);

    expect((await gqlRaw(query)).cache).toBe('HIT');

    // Simulate the #261 subscriber against the same Redis the server cached
    // into: an ENTRY_PUBLISHED for the Author clears content-type:Author<sfx>
    // AND entry:Author<sfx>:<authorId>, both of which tag the cached response.
    const url = getTestRedisUrl();
    const storage = createStorage({ driver: redisDriver({ url }) });
    const redis = new Redis(url);
    try {
      const cache = createTaggedCache({ storage, redis });
      await syncToCacheInvalidation(
        { cache },
        {
          event: 'ENTRY_PUBLISHED',
          contentType: { identifier: AUTHOR },
          entry: { id: authorId },
        }
      );
    } finally {
      await redis.quit();
      await storage.dispose();
    }

    expect((await gqlRaw(query)).cache).toBe('MISS'); // evicted
  });

  it('never caches a request that omits the opt-in header (Option B boundary)', async () => {
    // Without `x-boject-test-cache: 1`, graphql.ts never sets gqlCacheEligible
    // under VITEST, so the plugin returns early and sets no X-Cache header.
    // Locks the boundary so a future change can't silently start caching the
    // whole suite. Uses authorList (untouched by the other tests).
    const query = `{ ${camel(AUTHOR)}List { edges { node { id } } } }`;

    const first = await gqlRaw(query, false);
    expect(first.cache).not.toBe('HIT');
    const second = await gqlRaw(query, false);
    expect(second.cache).not.toBe('HIT');
  });
});
