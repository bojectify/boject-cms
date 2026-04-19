import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollHealth } from '../../src/health.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pollHealth', () => {
  it('resolves when fetch returns ok on first try', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 1000, intervalMs: 50 })
    ).resolves.toBeUndefined();
  });

  it('retries through connection errors and resolves when ok arrives', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 1000, intervalMs: 10 })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a timeout error when the deadline passes without success', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 100, intervalMs: 10 })
    ).rejects.toThrow(/timed out/i);
  });
});
