import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { getTestDatabaseUrl } from '../../../test/dbUrl';
import { resetRateLimitStore } from '../../utils/rateLimit';
import type { RateLimitedBody } from '../../utils/rateLimitEndpoint';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

const prismaUrl = getTestDatabaseUrl();
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

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

// One Nuxt test server for the whole file — calling setup() once per file is
// required by @nuxt/test-utils (a second setup() in a sibling describe leaves
// the first block's tests without a base URL). Both the namespace-policy and
// the route-behaviour blocks nest under this single outer describe.
describe('/api/public/entries', async () => {
  await setup({ dev: true });

  describe('namespace policy', () => {
    beforeEach(() => {
      resetRateLimitStore();
    });

    // The policy is enforced by the global auth middleware, which runs before
    // route resolution, so these 401 assertions hold regardless of the handler.
    // The route stays API-key-only, so they remain valid after Task 2.
    it('rejects a session-cookie caller with 401 (never session-authed)', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/public/entries?contentType=Anything', {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated caller with 401', async () => {
      const res = await fetch('/api/public/entries?contentType=Anything');
      expect(res.status).toBe(401);
    });

    it('accepts a valid API key (does not 401)', async () => {
      const res = await fetch('/api/public/entries?contentType=Anything', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).not.toBe(401);
    });
  });

  // A content type `PubThing<uuid>` with title + body (TEXT) + a RELATION
  // field. Entries A,B,C carry a PUBLISHED version; D is DRAFT-only and must
  // never surface on the public (PUBLISHED-only) surface. Seeded directly via
  // Prisma so we own every id and can scope assertions to them in the shared
  // boject_test DB.
  let PUB_IDENTIFIER: string;
  let pubContentTypeUuid: string;
  let relTargetTypeId: string;
  let relTargetEntryId: string;
  let publishedA: string;
  let publishedB: string;
  let publishedC: string;
  let draftD: string;
  let publishedSet: Set<string>;
  const RELATION_FIELD = 'related';

  beforeEach(() => {
    resetRateLimitStore();
  });

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    PUB_IDENTIFIER = `PubThing${suffix.replace(/-/g, '')}`;

    // A separate target type for the RELATION field to point at, plus one
    // entry to reference (so the relation value is a real ref, not invented).
    const relType = await prisma.contentType.create({
      data: {
        name: `PubRelTarget_${suffix}`,
        identifier: `PubRelTarget${suffix.replace(/-/g, '')}`,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    relTargetTypeId = relType.id;
    const relEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: relTargetTypeId,
        entryTitle: `Rel Target ${suffix}`,
        entryKey: `rel-target-${suffix}`,
        slug: `rel-target-${suffix}`,
        versions: {
          create: [
            {
              data: { title: `Rel Target ${suffix}` },
              entryTitle: `Rel Target ${suffix}`,
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    relTargetEntryId = relEntry.id;

    const ct = await prisma.contentType.create({
      data: {
        name: `PubThing_${suffix}`,
        identifier: PUB_IDENTIFIER,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
            { identifier: 'body', name: 'Body', type: 'TEXT', order: 1 },
            {
              identifier: RELATION_FIELD,
              name: 'Related',
              type: 'RELATION',
              order: 2,
              options: { targetContentTypeIds: [relTargetTypeId] },
            },
          ],
        },
      },
    });
    pubContentTypeUuid = ct.id;

    const relRef = {
      contentTypeId: relTargetTypeId,
      entryId: relTargetEntryId,
    };

    async function makePublished(label: string): Promise<string> {
      const e = await prisma.contentEntry.create({
        data: {
          contentTypeId: pubContentTypeUuid,
          entryTitle: `${label} ${suffix}`,
          entryKey: `${label.toLowerCase()}-${suffix}`,
          slug: `${label.toLowerCase()}-${suffix}`,
          versions: {
            create: [
              {
                data: {
                  title: `${label} ${suffix}`,
                  body: `body of ${label}`,
                  [RELATION_FIELD]: relRef,
                },
                entryTitle: `${label} ${suffix}`,
                status: 'PUBLISHED',
                publishedAt: new Date(),
              },
            ],
          },
        },
      });
      return e.id;
    }

    publishedA = await makePublished('Alpha');
    publishedB = await makePublished('Bravo');
    publishedC = await makePublished('Charlie');

    const d = await prisma.contentEntry.create({
      data: {
        contentTypeId: pubContentTypeUuid,
        entryTitle: `Delta ${suffix}`,
        entryKey: `delta-${suffix}`,
        slug: `delta-${suffix}`,
        versions: {
          create: [
            {
              data: { title: `Delta ${suffix}`, body: 'draft only' },
              entryTitle: `Delta ${suffix}`,
              status: 'DRAFT',
            },
          ],
        },
      },
    });
    draftD = d.id;

    publishedSet = new Set([publishedA, publishedB, publishedC]);
  });

  afterAll(async () => {
    await prisma.contentEntry.deleteMany({
      where: { contentTypeId: pubContentTypeUuid },
    });
    await prisma.contentTypeField.deleteMany({
      where: { contentTypeId: pubContentTypeUuid },
    });
    await prisma.contentType.delete({ where: { id: pubContentTypeUuid } });

    await prisma.contentEntry.deleteMany({
      where: { contentTypeId: relTargetTypeId },
    });
    await prisma.contentTypeField.deleteMany({
      where: { contentTypeId: relTargetTypeId },
    });
    await prisma.contentType.delete({ where: { id: relTargetTypeId } });

    await prisma.$disconnect();
  });

  it('returns only PUBLISHED entries, full field data, relations as refs', async () => {
    const res = await $fetch<{
      items: Array<Record<string, unknown>>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }>(`/api/public/entries?contentType=${PUB_IDENTIFIER}&perPage=100`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    const ids = res.items.map((i) => i.id);
    expect(ids).toContain(publishedA);
    expect(ids).toContain(publishedB);
    expect(ids).toContain(publishedC);
    expect(ids).not.toContain(draftD); // draft-only never appears

    const a = res.items.find((i) => i.id === publishedA)!;
    expect(a).toHaveProperty('data'); // full field data present
    // a RELATION field value stays a bare ref, not a resolved entry:
    const rel = (a.data as Record<string, unknown>)[RELATION_FIELD];
    expect(rel).toBeTruthy();
    if (rel) {
      expect(rel).toHaveProperty('entryId');
      expect((rel as { entryId: string }).entryId).toBe(relTargetEntryId);
      // a bare ref carries no resolved entry payload (e.g. entryTitle)
      expect(rel).not.toHaveProperty('entryTitle');
    }
    expect(res).not.toHaveProperty('total');
  });

  it('403 when the API key lacks content:read', async () => {
    // create a key without content:read via the session-authed apikeys endpoint
    const cookie = await getSessionCookie();
    const created = await $fetch<{ rawKey: string }>('/api/apikeys', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: { name: `pub-noread ${Date.now()}`, scopes: ['schema:read'] },
    });
    const res = await fetch(
      `/api/public/entries?contentType=${PUB_IDENTIFIER}`,
      {
        headers: { Authorization: `Bearer ${created.rawKey}` },
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      data?: { error?: string; required?: string };
    };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
    expect(body.data?.required).toBe('content:read');
  });

  it('400 when contentType is missing', async () => {
    const res = await fetch('/api/public/entries', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(400);
  });

  it('is identifier-only — a contentTypeId (UUID) alone is NOT accepted → 400', async () => {
    // public takes `contentType` (identifier); a bare UUID filter is rejected
    // because `contentType` is absent (no internal-id input on the public
    // surface).
    const res = await fetch(
      `/api/public/entries?contentTypeId=${pubContentTypeUuid}`,
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(res.status).toBe(400);
  });

  it('unknown contentType identifier returns an empty page (not 404)', async () => {
    const res = await $fetch<{
      items: unknown[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }>('/api/public/entries?contentType=NoSuchTypeXYZ', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.items).toEqual([]);
    expect(res.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });

  it('400 on a malformed after cursor', async () => {
    const res = await fetch(
      `/api/public/entries?contentType=${PUB_IDENTIFIER}&after=garbage`,
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(res.status).toBe(400);
  });

  it('forward keyset walk tiles with no dupes/gaps; response is forward-only', async () => {
    const seen: string[] = [];
    let after: string | null = null;
    let hasNext = true;
    let guard = 0;
    while (hasNext && guard++ < 50) {
      const url = `/api/public/entries?contentType=${PUB_IDENTIFIER}&perPage=2${
        after ? `&after=${encodeURIComponent(after)}` : ''
      }`;
      const page: {
        items: Array<{ id: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      } = await $fetch(url, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(page.pageInfo).not.toHaveProperty('hasPreviousPage'); // forward-only
      expect(page.pageInfo).not.toHaveProperty('startCursor');
      expect(page.pageInfo).not.toHaveProperty('total');
      seen.push(...page.items.map((i) => i.id));
      after = page.pageInfo.endCursor;
      hasNext = page.pageInfo.hasNextPage;
    }
    const mine = seen.filter((id) => publishedSet.has(id));
    expect(new Set(mine)).toEqual(publishedSet); // all present
    expect(mine.length).toBe(publishedSet.size); // no dupes
  });

  it('rate-limits a per-key flood with 429', async () => {
    // Drive a single API key past the public cap (default 120/60s). Because the
    // public namespace is API-key-only, the limiter buckets per apiKeyId — a
    // fresh dedicated key isolates this flood's budget from the rest of the
    // suite (the shared TEST_API_KEY would leak budget across tests).
    const rawKey = `boject_test_public_flood_${randomUUID().replace(/-/g, '')}`;
    const { createHash } = await import('node:crypto');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const created = await prisma.apiKey.create({
      data: {
        name: `public-flood-${Date.now()}`,
        keyHash,
        keyPrefix: rawKey.slice(0, 11),
        scopes: ['content:read'],
      },
    });
    try {
      let limited: Response | undefined;
      for (let i = 0; i < 130; i++) {
        const res = await fetch(
          `/api/public/entries?contentType=${PUB_IDENTIFIER}`,
          { headers: { Authorization: `Bearer ${rawKey}` } }
        );
        if (res.status === 429) {
          limited = res;
          break;
        }
      }
      expect(limited).toBeDefined();
      expect(limited!.status).toBe(429);
      const body = (await limited!.json()) as { data?: RateLimitedBody };
      expect(body.data?.error).toBe('RATE_LIMITED');
      expect(body.data?.message).toBe('Too many requests');
      expect(body.data?.retryAfter).toBeGreaterThanOrEqual(1);
      expect(body.data?.suggestion).toBe(
        'Honour Retry-After and cache responses at your edge — the public read API is cache-fronted, not built for un-cached hot-path polling.'
      );
      expect(limited!.headers.get('retry-after')).toBeDefined();
    } finally {
      await prisma.apiKey.delete({ where: { id: created.id } });
    }
  });
});
