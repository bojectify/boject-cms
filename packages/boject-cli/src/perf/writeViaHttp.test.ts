import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { GeneratedSeed } from './generate.js';
import {
  writeViaHttp,
  AuthError,
  ApiKeyReadOnlyError,
  RateLimitedError,
  EntryValidationError,
} from './writeViaHttp.js';
import { SeedMostlyDuplicateError } from './seedErrors.js';

const baseUrl = 'http://cms.test';
const apiKey = 'boject_test_key';

function makeGenerated(): GeneratedSeed {
  return {
    warnings: [],
    groups: [
      {
        contentTypeIdentifier: 'Author',
        entries: [
          {
            id: 'syn-a1',
            contentTypeId: 'ct-author',
            contentTypeIdentifier: 'Author',
            entryTitle: 'A1',
            slug: null,
            versions: [
              {
                status: 'PUBLISHED',
                data: { name: 'A1' },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        ],
      },
      {
        contentTypeIdentifier: 'Article',
        entries: [
          {
            id: 'syn-art1',
            contentTypeId: 'ct-article',
            contentTypeIdentifier: 'Article',
            entryTitle: 'Art',
            slug: 'art-0',
            versions: [
              {
                status: 'PUBLISHED',
                data: {
                  author: {
                    entryId: 'syn-a1',
                    contentTypeId: 'ct-author',
                    contentTypeIdentifier: 'Author',
                  },
                },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('writeViaHttp', () => {
  let server: SetupServer | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });
  afterAll(() => server?.close());

  it('POSTs to create + PUTs to publish, in topo order', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = await request.json();
        calls.push({ method: 'POST', path: '/api/content-entries', body });
        const id = `real-${calls.length}`;
        return HttpResponse.json({ id });
      }),
      http.put(
        `${baseUrl}/api/content-entries/:id`,
        async ({ params, request }) => {
          const body = await request.json();
          calls.push({
            method: 'PUT',
            path: `/api/content-entries/${params.id as string}`,
            body,
          });
          return HttpResponse.json({ id: params.id });
        }
      )
    );
    server.listen();

    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeGenerated(),
      concurrency: 1,
    });
    expect(r.inserted).toBe(2);
    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(['POST', 'PUT', 'POST', 'PUT']);
  });

  it('rewrites synthetic refs to real IDs across groups', async () => {
    const seenAuthorRefs: string[] = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as {
          contentTypeId?: string;
          data?: { author?: { entryId: string } };
        };
        const id =
          body.contentTypeId === 'ct-author'
            ? 'real-author-1'
            : 'real-article-1';
        if (body.data?.author) seenAuthorRefs.push(body.data.author.entryId);
        return HttpResponse.json({ id });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeGenerated(),
      concurrency: 1,
    });
    expect(seenAuthorRefs).toEqual(['real-author-1']);
  });

  it('honours 429 Retry-After', async () => {
    let attempts = 0;
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async () => {
        attempts++;
        if (attempts === 1) {
          return new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return HttpResponse.json({ id: 'real-1' });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    const generated = makeGenerated();
    generated.groups = [generated.groups[0]!];
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated,
      concurrency: 1,
    });
    expect(r.inserted).toBe(1);
    expect(attempts).toBe(2);
  });

  it('throws AuthError on 401', async () => {
    server = setupServer(
      http.post(
        `${baseUrl}/api/content-entries`,
        async () => new HttpResponse(null, { status: 401 })
      )
    );
    server.listen();

    const generated = makeGenerated();
    generated.groups = [generated.groups[0]!];
    await expect(
      writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ApiKeyReadOnlyError on 403 with read-only message', async () => {
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async () =>
        HttpResponse.json(
          { message: 'API keys have read-only access' },
          { status: 403 }
        )
      )
    );
    server.listen();

    const generated = makeGenerated();
    generated.groups = [generated.groups[0]!];
    await expect(
      writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 })
    ).rejects.toBeInstanceOf(ApiKeyReadOnlyError);
  });

  it('throws AuthError on generic 403', async () => {
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    );
    server.listen();

    const generated = makeGenerated();
    generated.groups = [generated.groups[0]!];
    await expect(
      writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws RateLimitedError after exhausting retries', async () => {
    server = setupServer(
      http.post(
        `${baseUrl}/api/content-entries`,
        async () =>
          new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '0' },
          })
      )
    );
    server.listen();

    const generated = makeGenerated();
    generated.groups = [generated.groups[0]!];
    await expect(
      writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 })
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('respects concurrency cap', async () => {
    let inflight = 0;
    let peak = 0;
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async () => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return HttpResponse.json({ id: `real-${peak}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: Array.from({ length: 8 }).map((_, i) => ({
            id: `syn-${i}`,
            contentTypeId: 'ct-author',
            contentTypeIdentifier: 'Author',
            entryTitle: `A${i}`,
            slug: null,
            versions: [
              {
                status: 'PUBLISHED' as const,
                data: { name: `A${i}` },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          })),
        },
      ],
    };
    await writeViaHttp({ baseUrl, apiKey, generated, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  // ----- 409 skip-and-continue (#194) -----

  function makeNAuthors(n: number): GeneratedSeed {
    return {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: Array.from({ length: n }).map((_, i) => ({
            id: `syn-${i}`,
            contentTypeId: 'ct-author',
            contentTypeIdentifier: 'Author',
            entryTitle: `A${i}`,
            slug: null,
            versions: [
              {
                status: 'PUBLISHED' as const,
                data: { name: `A${i}` },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          })),
        },
      ],
    };
  }

  /**
   * Build an MSW server where each successive POST returns the next
   * status code from `postStatuses`. PUT always succeeds.
   */
  function setupMultiPostServer(postStatuses: number[]): SetupServer {
    let i = 0;
    return setupServer(
      http.post(`${baseUrl}/api/content-entries`, async () => {
        const status = postStatuses[i++] ?? 500;
        if (status === 201) {
          return HttpResponse.json({ id: `real-${i}` });
        }
        return new HttpResponse(null, { status });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
  }

  it('all-success: returns { inserted: N, skipped: 0 }', async () => {
    server = setupMultiPostServer([201, 201, 201, 201, 201]);
    server.listen();
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeNAuthors(5),
      concurrency: 1,
    });
    expect(r).toEqual({ inserted: 5, skipped: 0 });
  });

  it('some-409 (25%): returns { inserted, skipped }, no throw', async () => {
    server = setupMultiPostServer([201, 201, 201, 409]);
    server.listen();
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeNAuthors(4),
      concurrency: 1,
    });
    expect(r).toEqual({ inserted: 3, skipped: 1 });
  });

  it('threshold trip (75%): throws SeedMostlyDuplicateError', async () => {
    server = setupMultiPostServer([201, 409, 409, 409]);
    server.listen();
    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({
        baseUrl,
        apiKey,
        generated: makeNAuthors(4),
        concurrency: 1,
      });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(1);
    expect(caught?.skipped).toBe(3);
    expect(caught?.total).toBe(4);
  });

  it('exact 50%: does NOT throw (strict >, not >=)', async () => {
    server = setupMultiPostServer([201, 201, 409, 409]);
    server.listen();
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeNAuthors(4),
      concurrency: 1,
    });
    expect(r).toEqual({ inserted: 2, skipped: 2 });
  });

  it('empty input: returns { inserted: 0, skipped: 0 } without threshold check', async () => {
    server = setupMultiPostServer([]);
    server.listen();
    const empty: GeneratedSeed = { warnings: [], groups: [] };
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: empty,
      concurrency: 1,
    });
    expect(r).toEqual({ inserted: 0, skipped: 0 });
  });

  it('onProgress only fires for inserts, not skips', async () => {
    server = setupMultiPostServer([201, 409, 201]);
    server.listen();
    const calls: Array<{ n: number; total: number }> = [];
    const r = await writeViaHttp({
      baseUrl,
      apiKey,
      generated: makeNAuthors(3),
      concurrency: 1,
      onProgress: (n, total) => calls.push({ n, total }),
    });
    expect(r).toEqual({ inserted: 2, skipped: 1 });
    expect(calls.map((c) => c.n)).toEqual([1, 2]);
    // `total` reflects the full input count (3), unchanged by skips.
    expect(calls.every((c) => c.total === 3)).toBe(true);
  });

  // ----- cascade-skip (#199) -----

  /**
   * Two-group bundle: N Authors followed by N Articles. Each Article's
   * `data.author` references the matching Author by synthetic ID.
   */
  function makeAuthorsAndArticles(n: number): GeneratedSeed {
    return {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: Array.from({ length: n }).map((_, i) => ({
            id: `syn-author-${i}`,
            contentTypeId: 'ct-author',
            contentTypeIdentifier: 'Author',
            entryTitle: `Author ${i}`,
            slug: null,
            versions: [
              {
                status: 'PUBLISHED' as const,
                data: { name: `Author ${i}` },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          })),
        },
        {
          contentTypeIdentifier: 'Article',
          entries: Array.from({ length: n }).map((_, i) => ({
            id: `syn-article-${i}`,
            contentTypeId: 'ct-article',
            contentTypeIdentifier: 'Article',
            entryTitle: `Article ${i}`,
            slug: `article-${i}`,
            versions: [
              {
                status: 'PUBLISHED' as const,
                data: {
                  title: `Article ${i}`,
                  author: {
                    entryId: `syn-author-${i}`,
                    contentTypeId: 'ct-author',
                    contentTypeIdentifier: 'Author',
                  },
                },
                publishedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          })),
        },
      ],
    };
  }

  it('single-hop cascade: Author 409 → Article cascade-skip, no POST attempted', async () => {
    const posted: Array<{ contentTypeId?: string }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as { contentTypeId?: string };
        posted.push(body);
        if (body.contentTypeId === 'ct-author') {
          return new HttpResponse(null, { status: 409 });
        }
        // Article POSTs should never happen.
        return HttpResponse.json({ id: `unexpected-${posted.length}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({
        baseUrl,
        apiKey,
        generated: makeAuthorsAndArticles(2),
        concurrency: 1,
      });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    // 4 total entries (2 authors + 2 articles), all skipped → 100% > 50%.
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(0);
    expect(caught?.skipped).toBe(4);
    expect(caught?.total).toBe(4);
    // Only the 2 authors were POSTed; the 2 articles were cascade-skipped.
    expect(posted).toHaveLength(2);
    expect(posted.every((p) => p.contentTypeId === 'ct-author')).toBe(true);
  });

  it('multi-hop cascade: Category 409 → Article cascade → Comment cascade', async () => {
    const posted: Array<{ contentTypeId?: string }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as { contentTypeId?: string };
        posted.push(body);
        if (body.contentTypeId === 'ct-category') {
          return new HttpResponse(null, { status: 409 });
        }
        return HttpResponse.json({ id: `unexpected-${posted.length}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Category',
          entries: [
            {
              id: 'syn-cat-0',
              contentTypeId: 'ct-category',
              contentTypeIdentifier: 'Category',
              entryTitle: 'Cat 0',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'Cat 0' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-art-0',
              contentTypeId: 'ct-article',
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art 0',
              slug: 'art-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    title: 'Art 0',
                    category: {
                      entryId: 'syn-cat-0',
                      contentTypeId: 'ct-category',
                      contentTypeIdentifier: 'Category',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Comment',
          entries: [
            {
              id: 'syn-com-0',
              contentTypeId: 'ct-comment',
              contentTypeIdentifier: 'Comment',
              entryTitle: 'Com 0',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    body: 'hi',
                    article: {
                      entryId: 'syn-art-0',
                      contentTypeId: 'ct-article',
                      contentTypeIdentifier: 'Article',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };

    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(0);
    expect(caught?.skipped).toBe(3);
    expect(caught?.total).toBe(3);
    // Only the Category POST fired; Article + Comment cascade-skipped.
    expect(posted).toHaveLength(1);
    expect(posted[0]!.contentTypeId).toBe('ct-category');
  });

  it('MULTIRELATION with mixed refs: cascade-skip when one ref is in skippedIds', async () => {
    const posted: Array<{ contentTypeId?: string }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as {
          contentTypeId?: string;
          data?: { name?: string };
        };
        posted.push(body);
        // Author A0 inserts cleanly; Author A1 conflicts (409).
        if (body.contentTypeId === 'ct-author') {
          if (body.data?.name === 'A1') {
            return new HttpResponse(null, { status: 409 });
          }
          return HttpResponse.json({ id: 'real-author-0' });
        }
        // Article POST should never fire — it references the skipped A1.
        return HttpResponse.json({ id: `unexpected-${posted.length}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'syn-a0',
              contentTypeId: 'ct-author',
              contentTypeIdentifier: 'Author',
              entryTitle: 'A0',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A0' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            {
              id: 'syn-a1',
              contentTypeId: 'ct-author',
              contentTypeIdentifier: 'Author',
              entryTitle: 'A1',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A1' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-art-0',
              contentTypeId: 'ct-article',
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art 0',
              slug: 'art-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    title: 'Art 0',
                    authors: [
                      {
                        entryId: 'syn-a0',
                        contentTypeId: 'ct-author',
                        contentTypeIdentifier: 'Author',
                      },
                      {
                        entryId: 'syn-a1',
                        contentTypeId: 'ct-author',
                        contentTypeIdentifier: 'Author',
                      },
                    ],
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };

    // 1 inserted (A0), 2 skipped (A1 via 409 + Article cascade on A1).
    // 2/3 ≈ 0.667 > 0.5 → SeedMostlyDuplicateError fires. The interesting
    // assertion is that the Article was NOT POSTed (it cascade-skipped on
    // the MULTIRELATION ref to A1, not on its mapped ref to A0).
    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(1);
    expect(caught?.skipped).toBe(2);
    expect(caught?.total).toBe(3);
    // Only the two Author POSTs fired (A0 success + A1 409). The Article
    // never reached the server.
    const authorPosts = posted.filter((p) => p.contentTypeId === 'ct-author');
    const articlePosts = posted.filter((p) => p.contentTypeId === 'ct-article');
    expect(authorPosts).toHaveLength(2);
    expect(articlePosts).toHaveLength(0);
  });

  it('RICHTEXT body embed cascade: cmsEmbed pointing at skipped entry → cascade-skip', async () => {
    const posted: Array<{ contentTypeId?: string }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as { contentTypeId?: string };
        posted.push(body);
        if (body.contentTypeId === 'ct-author') {
          return new HttpResponse(null, { status: 409 });
        }
        return HttpResponse.json({ id: `unexpected-${posted.length}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'syn-author-0',
              contentTypeId: 'ct-author',
              contentTypeIdentifier: 'Author',
              entryTitle: 'A0',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A0' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-art-0',
              contentTypeId: 'ct-article',
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art 0',
              slug: 'art-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    body: {
                      type: 'doc',
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            {
                              type: 'cmsEmbed',
                              attrs: {
                                entryId: 'syn-author-0',
                                contentTypeId: 'ct-author',
                                contentTypeIdentifier: 'Author',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };

    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({ baseUrl, apiKey, generated, concurrency: 1 });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(0);
    expect(caught?.skipped).toBe(2);
    expect(caught?.total).toBe(2);
    // Only the Author POST fired; the Article was cascade-skipped on
    // strength of the cmsEmbed ref.
    expect(posted).toHaveLength(1);
    expect(posted[0]!.contentTypeId).toBe('ct-author');
  });

  it('threshold trip via cascade: 10 authors 409 + 10 articles cascade → SeedMostlyDuplicateError', async () => {
    const posted: Array<{ contentTypeId?: string }> = [];
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as { contentTypeId?: string };
        posted.push(body);
        if (body.contentTypeId === 'ct-author') {
          return new HttpResponse(null, { status: 409 });
        }
        // Articles should never reach here.
        return HttpResponse.json({ id: `unexpected-${posted.length}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();

    let caught: SeedMostlyDuplicateError | null = null;
    try {
      await writeViaHttp({
        baseUrl,
        apiKey,
        generated: makeAuthorsAndArticles(10),
        concurrency: 1,
      });
    } catch (err) {
      caught = err as SeedMostlyDuplicateError;
    }
    expect(caught).toBeInstanceOf(SeedMostlyDuplicateError);
    expect(caught?.inserted).toBe(0);
    expect(caught?.skipped).toBe(20);
    expect(caught?.total).toBe(20);
    // 10 authors POSTed; 10 articles cascade-skipped (no POST attempted).
    expect(posted).toHaveLength(10);
    expect(posted.every((p) => p.contentTypeId === 'ct-author')).toBe(true);
  });

  it('mixed status codes: 422 still throws, 409 silenced, 429 retried', async () => {
    // Identify each logical entry via its synthetic id (`syn-N`) so 429
    // retries don't shift sequencing. Per-entry plan:
    //   syn-0: 201
    //   syn-1: 409 (skip)
    //   syn-2: 429 once, then 201
    //   syn-3: 422 (throws EntryValidationError)
    const attemptsByEntry: Record<string, number> = {};
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, async ({ request }) => {
        const body = (await request.json()) as {
          data?: { name?: string };
        };
        const name = body.data?.name ?? '';
        attemptsByEntry[name] = (attemptsByEntry[name] ?? 0) + 1;
        if (name === 'A0') return HttpResponse.json({ id: 'real-0' });
        if (name === 'A1') return new HttpResponse(null, { status: 409 });
        if (name === 'A2') {
          if (attemptsByEntry[name] === 1) {
            return new HttpResponse(null, {
              status: 429,
              headers: { 'Retry-After': '0' },
            });
          }
          return HttpResponse.json({ id: 'real-2' });
        }
        if (name === 'A3') {
          return HttpResponse.json({ message: 'invalid' }, { status: 422 });
        }
        return new HttpResponse(null, { status: 500 });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, async ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    await expect(
      writeViaHttp({
        baseUrl,
        apiKey,
        generated: makeNAuthors(4),
        concurrency: 1,
      })
    ).rejects.toBeInstanceOf(EntryValidationError);
    // The 409 was silenced (didn't throw); the 422 propagated; the 429
    // path was retried successfully but is not asserted here beyond the
    // fact that it didn't error before A3 was reached.
    expect(attemptsByEntry['A1']).toBe(1);
    expect(attemptsByEntry['A2']).toBe(2);
    expect(attemptsByEntry['A3']).toBe(1);
  });
});
