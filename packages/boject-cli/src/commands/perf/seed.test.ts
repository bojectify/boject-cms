import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runPerfSeed } from './seed.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const baseUrl = 'http://cms.test';
const apiKey = 'boject_test';

const minimalBundleResponse = {
  version: 2,
  exportedAt: '2026-05-07T00:00:00.000Z',
  portable: false,
  contentTypes: [
    {
      id: 'ct-page',
      identifier: 'Page',
      name: 'Page',
      description: null,
      fields: [
        {
          id: 'f1',
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          unique: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

describe('runPerfSeed', () => {
  let server: SetupServer | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });
  afterAll(() => server?.close());

  it('refuses without a transport flag', async () => {
    await expect(
      runPerfSeed({
        contentType: 'Page',
        size: 5,
        url: baseUrl,
        apiKey,
        yes: true,
      })
    ).rejects.toThrow(/--database-url|--http-seed/);
  });

  it('refuses with both transport flags', async () => {
    await expect(
      runPerfSeed({
        contentType: 'Page',
        size: 5,
        databaseUrl: 'postgresql://u:p@h/boject_perf',
        httpSeed: true,
        url: baseUrl,
        apiKey,
        yes: true,
      })
    ).rejects.toThrow(/exactly one/i);
  });

  it('refuses if the requested content type is missing from the bundle', async () => {
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      )
    );
    server.listen();
    await expect(
      runPerfSeed({
        contentType: 'Ghost',
        size: 5,
        httpSeed: true,
        url: baseUrl,
        apiKey,
        yes: true,
      })
    ).rejects.toThrow(/Ghost/);
  });

  it('seeds via HTTP successfully', async () => {
    let posts = 0;
    let puts = 0;
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      ),
      http.post(`${baseUrl}/api/content-entries`, () => {
        posts++;
        return HttpResponse.json({ id: `real-${posts}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) => {
        puts++;
        return HttpResponse.json({ id: params.id });
      })
    );
    server.listen();
    const r = await runPerfSeed({
      contentType: 'Page',
      size: 3,
      httpSeed: true,
      url: baseUrl,
      apiKey,
      yes: true,
    });
    expect(r.inserted).toBe(3);
    expect(posts).toBe(3);
    expect(puts).toBe(3);
  });

  it('refuses non-/boject_perf SQL URL without --allow-non-perf-db', async () => {
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      )
    );
    server.listen();
    await expect(
      runPerfSeed({
        contentType: 'Page',
        size: 3,
        databaseUrl: 'postgresql://u:p@h/staging',
        url: baseUrl,
        apiKey,
        yes: true,
      })
    ).rejects.toThrow(/non.?perf|allow-non-perf-db/i);
  });

  it('loads bundle from --bundle path when provided', async () => {
    const path = resolve(HERE, '../../perf/fixtures/minimal.bundle.json');
    server = setupServer(
      http.post(`${baseUrl}/api/content-entries`, () =>
        HttpResponse.json({ id: 'real-1' })
      ),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    const r = await runPerfSeed({
      contentType: 'Page',
      size: 1,
      httpSeed: true,
      bundle: path,
      url: baseUrl,
      apiKey,
      yes: true,
    });
    expect(r.inserted).toBe(1);
  });
});
