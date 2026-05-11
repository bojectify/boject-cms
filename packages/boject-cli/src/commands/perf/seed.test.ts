import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runPerfSeed } from './seed.js';
import type {
  ProbeResult,
  probeContentWriteScope,
} from '../../perf/probeContentWriteScope.js';

function makeProbe(result: ProbeResult): typeof probeContentWriteScope {
  return async () => result;
}

const okProbe = makeProbe({ ok: true });

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
        probeContentWrite: okProbe,
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
      probeContentWrite: okProbe,
    });
    expect(r.inserted).toBe(3);
    expect(posts).toBe(3);
    expect(puts).toBe(3);
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
      probeContentWrite: okProbe,
    });
    expect(r.inserted).toBe(1);
  });

  it('throws with actionable error when probe reports missing scope (HTTP)', async () => {
    let posts = 0;
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      ),
      http.post(`${baseUrl}/api/content-entries`, () => {
        posts++;
        return HttpResponse.json({ id: `real-${posts}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      await expect(
        runPerfSeed({
          contentType: 'Page',
          size: 3,
          httpSeed: true,
          url: baseUrl,
          apiKey,
          yes: true,
          probeContentWrite: makeProbe({
            ok: false,
            missingScope: 'content:write',
          }),
        })
      ).rejects.toThrow(
        /API key missing required scope "content:write".*boject apikey create/s
      );
      expect(posts).toBe(0);
      const rateLimitLogCalls = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rate limiter is 50 req/60s')
      );
      expect(rateLimitLogCalls).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('throws with actionable error when probe is indeterminate (e.g. 429)', async () => {
    let posts = 0;
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      ),
      http.post(`${baseUrl}/api/content-entries`, () => {
        posts++;
        return HttpResponse.json({ id: `real-${posts}` });
      }),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      await expect(
        runPerfSeed({
          contentType: 'Page',
          size: 3,
          httpSeed: true,
          url: baseUrl,
          apiKey,
          yes: true,
          probeContentWrite: makeProbe({
            ok: false,
            error: 'rate limited by CMS — wait 60s and retry',
          }),
        })
      ).rejects.toThrow(
        /Could not verify content:write scope: rate limited by CMS/
      );
      expect(posts).toBe(0);
      const rateLimitLogCalls = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rate limiter is 50 req/60s')
      );
      expect(rateLimitLogCalls).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('emits the rate-limiter heads-up log exactly once on successful HTTP seed', async () => {
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      ),
      http.post(`${baseUrl}/api/content-entries`, () =>
        HttpResponse.json({ id: 'real-1' })
      ),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const r = await runPerfSeed({
        contentType: 'Page',
        size: 2,
        httpSeed: true,
        url: baseUrl,
        apiKey,
        yes: true,
        probeContentWrite: okProbe,
      });
      expect(r.inserted).toBe(2);
      const rateLimitLogCalls = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rate limiter is 50 req/60s')
      );
      expect(rateLimitLogCalls).toHaveLength(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('uses the injected probe (not the real implementation) when provided', async () => {
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      ),
      http.post(`${baseUrl}/api/content-entries`, () =>
        HttpResponse.json({ id: 'real-1' })
      ),
      http.put(`${baseUrl}/api/content-entries/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id })
      )
    );
    server.listen();
    const probeSpy = vi.fn(async () => ({ ok: true }) as ProbeResult);
    await runPerfSeed({
      contentType: 'Page',
      size: 1,
      httpSeed: true,
      url: baseUrl,
      apiKey,
      yes: true,
      probeContentWrite: probeSpy,
    });
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy).toHaveBeenCalledWith({
      baseUrl,
      apiKey,
    });
  });

  it('does NOT call the probe or emit the rate-limit log on SQL transport', async () => {
    // Use a non-real DB URL — writeViaSql will throw on connect. We only
    // care that the probe was never called and the log was never emitted
    // BEFORE we reached the SQL path.
    const probeSpy = vi.fn(async () => ({ ok: true }) as ProbeResult);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    server = setupServer(
      http.get(`${baseUrl}/api/schema/export`, () =>
        HttpResponse.json(minimalBundleResponse)
      )
    );
    server.listen();
    try {
      await expect(
        runPerfSeed({
          contentType: 'Page',
          size: 1,
          databaseUrl: 'postgresql://noone:nothing@127.0.0.1:1/boject_perf',
          allowDatabase: ['boject_perf'],
          url: baseUrl,
          apiKey,
          yes: true,
          probeContentWrite: probeSpy,
        })
      ).rejects.toThrow();
      expect(probeSpy).not.toHaveBeenCalled();
      const rateLimitLogCalls = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rate limiter is 50 req/60s')
      );
      expect(rateLimitLogCalls).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
