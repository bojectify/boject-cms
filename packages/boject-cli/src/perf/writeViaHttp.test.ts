import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { GeneratedSeed } from './generate.js';
import {
  writeViaHttp,
  AuthError,
  ApiKeyReadOnlyError,
  RateLimitedError,
} from './writeViaHttp.js';

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
});
