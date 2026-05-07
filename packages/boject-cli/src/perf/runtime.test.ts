import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultK6Available,
  defaultK6Version,
  defaultFetchHealth,
} from './runtime.js';

afterEach(() => vi.restoreAllMocks());

describe('defaultK6Available', () => {
  it('returns false when k6 binary is not on PATH', async () => {
    // Simulate not-on-PATH by setting PATH to an empty dir for the test scope.
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      const r = await defaultK6Available();
      expect(r).toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('defaultK6Version', () => {
  it('returns "unknown" when k6 is not on PATH', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      expect(await defaultK6Version()).toBe('unknown');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('defaultFetchHealth', () => {
  it('returns ok: true on 200', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('ok', { status: 200 })
    ) as typeof fetch;
    const r = await defaultFetchHealth('https://x.example.com');
    expect(r).toEqual({ ok: true });
  });

  it('returns ok: false with HTTP status on non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 503 })
    ) as typeof fetch;
    const r = await defaultFetchHealth('https://x.example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/HTTP 503/);
  });

  it('returns ok: false on network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const r = await defaultFetchHealth('https://x.example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/fetch failed/);
  });

  it('strips trailing slash from URL before joining /api/health', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await defaultFetchHealth('https://x.example.com/');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://x.example.com/api/health',
      expect.any(Object)
    );
  });
});
