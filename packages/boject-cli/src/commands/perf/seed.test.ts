import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { runPerfSeed } from './seed.js';

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
    ).rejects.toThrow(/--database-url/);
  });

  it('refuses non-suffix SQL URL without --allow-database', async () => {
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
    ).rejects.toThrow(/--allow-database|_perf|_staging/i);
  });
});
