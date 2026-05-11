import { describe, expect, it } from 'vitest';
import { probeContentWriteScope } from './probeContentWriteScope.js';

interface FakeResponse {
  status: number;
  json?: () => Promise<unknown>;
}

function makeFakeFetch(response: FakeResponse): typeof fetch {
  return (async (_url: string, _init?: RequestInit) => {
    return {
      status: response.status,
      json: response.json ?? (async () => ({})),
    } as Response;
  }) as unknown as typeof fetch;
}

const BASE_URL = 'https://cms.example.com';
const API_KEY = 'boject_test_key';

describe('probeContentWriteScope', () => {
  it('returns ok on 200', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 200 }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok on 400 (body validation got past scope check)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 400 }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok on 404 (content-type-not-found got past scope check)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 404 }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns missingScope on 403 with INSUFFICIENT_SCOPE error code', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({
        status: 403,
        json: async () => ({
          statusCode: 403,
          statusMessage: 'API key missing required scope: content:write',
          message: 'API key missing required scope: content:write',
          data: { error: 'INSUFFICIENT_SCOPE', required: 'content:write' },
        }),
      }),
    });
    expect(result).toEqual({ ok: false, missingScope: 'content:write' });
  });

  it('returns indeterminate on 403 with a different error code', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({
        status: 403,
        json: async () => ({
          statusCode: 403,
          data: { error: 'SOMETHING_ELSE' },
        }),
      }),
    });
    expect(result).toEqual({
      ok: false,
      error: 'unexpected 403 from probe endpoint',
    });
  });

  it('returns missingScope on 403 with unparseable body (defensive)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({
        status: 403,
        json: async () => {
          throw new Error('not json');
        },
      }),
    });
    expect(result).toEqual({ ok: false, missingScope: 'content:write' });
  });

  it('returns missingScope on 403 with parseable JSON but no data field (defensive)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({
        status: 403,
        json: async () => ({ statusCode: 403, message: 'forbidden' }),
      }),
    });
    expect(result).toEqual({ ok: false, missingScope: 'content:write' });
  });

  it('returns indeterminate on 401 (invalid or revoked key)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 401 }),
    });
    expect(result).toEqual({
      ok: false,
      error: 'API key invalid or revoked',
    });
  });

  it('returns indeterminate on 429 (rate limited before scope check)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 429 }),
    });
    expect(result).toEqual({
      ok: false,
      error: 'rate limited by CMS — wait 60s and retry',
    });
  });

  it('returns ok on 500 (server error means we got past scope check)', async () => {
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: makeFakeFetch({ status: 500 }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns indeterminate on network exception', async () => {
    const failingFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await probeContentWriteScope({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetchImpl: failingFetch,
    });
    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('strips trailing slash from baseUrl', async () => {
    let observedUrl: string | undefined;
    const capturingFetch = (async (url: string, _init?: RequestInit) => {
      observedUrl = url;
      return {
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    await probeContentWriteScope({
      baseUrl: 'https://x.com/',
      apiKey: API_KEY,
      fetchImpl: capturingFetch,
    });
    expect(observedUrl).toBe('https://x.com/api/content-entries');
  });
});
