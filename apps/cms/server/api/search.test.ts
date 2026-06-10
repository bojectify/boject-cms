import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../test/credentials';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { addTestDocuments, clearTestIndex } from '../test/meiliTestUtils';
import type { SearchDocument } from '../utils/searchDocument';
import type { RateLimitedBody } from '../utils/rateLimitEndpoint';

const prismaUrl = getTestDatabaseUrl();
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type SearchHit = {
  id: string;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  snippet: string | null;
  publishedAt: string | null;
};

type SearchResponse = {
  hits: SearchHit[];
  total: number;
  page: number;
  perPage: number;
  processingTimeMs: number;
};

/** A minimal SearchDocument for seeding the test index. */
function doc(over: Partial<SearchDocument> & { id: string }): SearchDocument {
  return {
    entryKey: over.id,
    contentType: 'Article',
    entryTitle: 'Untitled',
    publishedAt: '2026-01-01T00:00:00.000Z',
    fields: {},
    ...over,
  };
}

function search(
  params: Record<string, string | number>,
  key: string = TEST_API_KEY
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  return $fetch<SearchResponse>(`/api/search?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
}

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
    headers: { 'Content-Type': 'application/json' },
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

describe('GET /api/search', async () => {
  await setup({ dev: true });

  // Typed-operator filters (NUMBER gt, SELECT in, the 400-for-wrong-type case)
  // require the scoped content type's field types to be resolvable from
  // Postgres (`resolveContentTypeFieldTypes` reads ContentType.fields by
  // identifier). The existing equality tests only seed Meili docs (hardcoded
  // `contentType: 'Article'` with no Postgres row), which is fine for the
  // unknown-type → eq back-compat path — but typed operators need a real
  // ContentType + field defs in Postgres AND matching docs in Meili. We create
  // the `Widget` type once and tear it down after the suite.
  let widgetTypeId: string | null = null;
  beforeAll(async () => {
    const ct = await prisma.contentType.create({
      data: {
        name: 'Widget',
        identifier: 'Widget',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
            },
            { identifier: 'price', name: 'Price', type: 'NUMBER', order: 1 },
            {
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              order: 2,
              options: { choices: ['a', 'b', 'c'] },
            },
            { identifier: 'colour', name: 'Colour', type: 'TEXT', order: 3 },
          ],
        },
      },
    });
    widgetTypeId = ct.id;
  });

  afterAll(async () => {
    if (widgetTypeId) {
      await prisma.contentType.delete({ where: { id: widgetTypeId } });
    }
  });

  beforeEach(async () => {
    await clearTestIndex();
  });

  it('returns an empty result set with the standard envelope', async () => {
    await addTestDocuments([
      doc({ id: 'empty-1', entryTitle: 'Something Else' }),
    ]);
    const res = await search({ q: 'zzznomatch' });
    expect(res.hits).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.page).toBe(1);
    expect(res.perPage).toBe(15);
    expect(typeof res.processingTimeMs).toBe('number');
  });

  it('scopes results to a single content type via contentType', async () => {
    await addTestDocuments([
      doc({
        id: 'art-alpha',
        contentType: 'Article',
        entryTitle: 'Alpha Article',
      }),
      doc({ id: 'page-alpha', contentType: 'Page', entryTitle: 'Alpha Page' }),
    ]);
    const res = await search({ q: 'alpha', contentType: 'Article' });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.id).toBe('art-alpha');
    expect(res.hits[0]!.contentType).toBe('Article');
  });

  it('paginates and reports the right page/perPage shape', async () => {
    await addTestDocuments([
      doc({ id: 'pg-1', entryTitle: 'Paginate One' }),
      doc({ id: 'pg-2', entryTitle: 'Paginate Two' }),
      doc({ id: 'pg-3', entryTitle: 'Paginate Three' }),
    ]);
    const res = await search({ q: 'paginate', page: 2, perPage: 1 });
    expect(res.page).toBe(2);
    expect(res.perPage).toBe(1);
    expect(res.total).toBe(3);
    expect(res.hits).toHaveLength(1);
    expect(typeof res.processingTimeMs).toBe('number');
    expect(res).toHaveProperty('hits');
    expect(res).toHaveProperty('total');
  });

  it('applies a per-field filter (q may be empty)', async () => {
    await addTestDocuments([
      doc({
        id: 'by-author-1',
        contentType: 'Article',
        entryTitle: 'By Author One',
        fields: { author: 'author-1' },
      }),
      doc({
        id: 'by-author-2',
        contentType: 'Article',
        entryTitle: 'By Author Two',
        fields: { author: 'author-2' },
      }),
    ]);
    const res = await search({
      q: '',
      contentType: 'Article',
      filter: 'author:author-1',
    });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.id).toBe('by-author-1');
  });

  it('applies a NUMBER comparison via field:op:value (gt)', async () => {
    await addTestDocuments([
      doc({
        id: 'widget-cheap',
        contentType: 'Widget',
        entryTitle: 'Cheap Widget',
        fields: { price: 5 },
      }),
      doc({
        id: 'widget-mid',
        contentType: 'Widget',
        entryTitle: 'Mid Widget',
        fields: { price: 15 },
      }),
      doc({
        id: 'widget-pricey',
        contentType: 'Widget',
        entryTitle: 'Pricey Widget',
        fields: { price: 25 },
      }),
    ]);
    const res = await search({
      q: '',
      contentType: 'Widget',
      filter: 'price:gt:10',
    });
    expect(res.hits.map((h) => h.id).sort()).toEqual([
      'widget-mid',
      'widget-pricey',
    ]);
  });

  it('applies a multi-value op (SELECT in) with comma-separated values', async () => {
    await addTestDocuments([
      doc({
        id: 'cat-a',
        contentType: 'Widget',
        entryTitle: 'Cat A',
        fields: { category: 'a' },
      }),
      doc({
        id: 'cat-b',
        contentType: 'Widget',
        entryTitle: 'Cat B',
        fields: { category: 'b' },
      }),
      doc({
        id: 'cat-c',
        contentType: 'Widget',
        entryTitle: 'Cat C',
        fields: { category: 'c' },
      }),
    ]);
    const res = await search({
      q: '',
      contentType: 'Widget',
      filter: 'category:in:a,b',
    });
    expect(res.hits.map((h) => h.id).sort()).toEqual(['cat-a', 'cat-b']);
  });

  it('treats the legacy 2-part field:value form as equality', async () => {
    await addTestDocuments([
      doc({
        id: 'colour-red',
        contentType: 'Widget',
        entryTitle: 'Red Widget',
        fields: { colour: 'red' },
      }),
      doc({
        id: 'colour-blue',
        contentType: 'Widget',
        entryTitle: 'Blue Widget',
        fields: { colour: 'blue' },
      }),
    ]);
    const res = await search({
      q: '',
      contentType: 'Widget',
      filter: 'colour:red',
    });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.id).toBe('colour-red');
  });

  it('returns 400 for an operator not valid for the field type', async () => {
    // `gt` is a NUMBER operator; applying it to a TEXT field is rejected by the
    // compiler (SearchInputError → 400), not silently ignored.
    const res = await fetch(
      '/api/search?q=x&contentType=Widget&filter=colour:gt:5',
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(res.status).toBe(400);
  });

  it('falls back to eq for a 2-part filter with no contentType scope', async () => {
    // Without a contentType the field type is unknown, so the compiler allows
    // only equality-as-quoted-string (the #227 back-compat path). It must not
    // 500/503 and must return the matching doc.
    await addTestDocuments([
      doc({
        id: 'noscope-1',
        contentType: 'Article',
        entryTitle: 'No Scope One',
        fields: { author: 'author-9' },
      }),
      doc({
        id: 'noscope-2',
        contentType: 'Page',
        entryTitle: 'No Scope Two',
        fields: { author: 'author-8' },
      }),
    ]);
    const res = await search({ q: '', filter: 'author:author-9' });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.id).toBe('noscope-1');
  });

  it('narrows the free-text search via attributesToSearchOn', async () => {
    await addTestDocuments([
      doc({
        id: 'title-match',
        entryTitle: 'Quokka Headline',
        fields: { body: 'an unrelated body' },
      }),
      doc({
        id: 'body-match',
        entryTitle: 'Unrelated Headline',
        fields: { body: 'mentions quokka in the body only' },
      }),
    ]);
    const res = await search({
      q: 'quokka',
      attributesToSearchOn: 'entryTitle',
    });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.id).toBe('title-match');
  });

  it('returns 400 (not 503) for an unknown attributesToSearchOn', async () => {
    const res = await fetch('/api/search?q=x&attributesToSearchOn=notReal', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 for an API key without content:read', async () => {
    const rawKey = `boject_test_no_read_${Date.now()}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const created = await prisma.apiKey.create({
      data: {
        name: `search-no-read-${Date.now()}`,
        keyHash,
        keyPrefix: rawKey.slice(0, 11),
        scopes: ['schema:read'],
      },
    });
    try {
      const res = await fetch('/api/search?q=x', {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        data?: { error?: string; required?: string };
      };
      expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
      expect(body.data?.required).toBe('content:read');
    } finally {
      await prisma.apiKey.delete({ where: { id: created.id } });
    }
  });

  it('rate-limits a per-key flood with 429', async () => {
    await addTestDocuments([
      doc({ id: 'flood-1', entryTitle: 'Flood Target' }),
    ]);
    // The endpoint rate-limits per request IP for session-authed callers
    // (no api key id in context), so drive a unique x-forwarded-for IP to
    // isolate this flood's budget from the rest of the suite — mirroring the
    // files.test.ts transform 429 pattern. The default cap is 120/60s.
    const cookie = await getSessionCookie();
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
    let limited: Response | undefined;
    for (let i = 0; i < 130; i++) {
      const res = await fetch('/api/search?q=flood', {
        headers: { cookie, 'x-forwarded-for': ip },
      });
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
      'Slow your search request rate, or cache results client-side.'
    );
    expect(limited!.headers.get('retry-after')).toBeDefined();
  });
});
