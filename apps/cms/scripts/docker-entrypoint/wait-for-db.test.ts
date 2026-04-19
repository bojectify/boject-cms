import { describe, expect, it, vi } from 'vitest';
import { waitForDb } from './wait-for-db';

describe('waitForDb', () => {
  it('resolves immediately when probe succeeds on first try', async () => {
    const probe = vi.fn().mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForDb({
      databaseUrl: 'postgresql://localhost:5432/nope',
      timeoutMs: 5000,
      intervalMs: 500,
      probe,
      sleep,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries until probe succeeds', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForDb({
      databaseUrl: 'postgresql://localhost:5432/nope',
      timeoutMs: 5000,
      intervalMs: 500,
      probe,
      sleep,
    });

    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('throws when timeout is exhausted', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('refused'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    const now = () => (t += 200); // each call advances 200ms

    await expect(
      waitForDb({
        databaseUrl: 'postgresql://localhost:5432/nope',
        timeoutMs: 500,
        intervalMs: 100,
        probe,
        sleep,
        now,
      })
    ).rejects.toThrow(/timed out/i);

    expect(probe).toHaveBeenCalled();
  });
});
