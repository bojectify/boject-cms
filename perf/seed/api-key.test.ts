import { describe, expect, it, vi } from 'vitest';
import { ensurePerfApiKey } from './api-key';

describe('ensurePerfApiKey', () => {
  it('returns the raw key when the hash row exists', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'x' });
    const key = await ensurePerfApiKey({
      prisma: { apiKey: { findUnique } } as never,
    });
    expect(key).toBe('boject_perf_key_for_load_tests_only');
    expect(findUnique).toHaveBeenCalled();
  });

  it('throws with actionable message when row missing', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      ensurePerfApiKey({
        prisma: { apiKey: { findUnique } } as never,
      })
    ).rejects.toThrow(/SEED_PERF_KEY=1/);
  });
});
