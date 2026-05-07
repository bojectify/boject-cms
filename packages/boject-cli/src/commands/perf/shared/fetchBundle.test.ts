import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchBundle } from './fetchBundle.js';

const baseUrl = 'http://cms.test';
const apiKey = 'boject_test';

describe('fetchBundle', () => {
  let server: SetupServer | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });
  afterAll(() => server?.close());

  it('GETs /api/schema/export with the API key and returns the bundle', async () => {
    let receivedAuth = '';
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization') ?? '';
        return HttpResponse.json({
          version: 2,
          exportedAt: '2026-05-07T00:00:00.000Z',
          portable: false,
          contentTypes: [],
        });
      })
    );
    server.listen();
    const bundle = await fetchBundle({ baseUrl, apiKey });
    expect(bundle.version).toBe(2);
    expect(receivedAuth).toBe(`Bearer ${apiKey}`);
  });

  it('throws on a non-200 response', async () => {
    server = setupServer(
      http.get(
        `${baseUrl}/api/schema/export`,
        () => new HttpResponse(null, { status: 401 })
      )
    );
    server.listen();
    await expect(fetchBundle({ baseUrl, apiKey })).rejects.toThrow(/401|auth/i);
  });
});
