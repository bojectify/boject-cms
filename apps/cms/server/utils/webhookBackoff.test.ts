import { describe, it, expect } from 'vitest';
import { MAX_ATTEMPTS, backoffMs } from './webhookBackoff';

describe('webhookBackoff', () => {
  it('schedule is 1s, 10s, 1m, 10m, 1h, 6h', () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(4)).toBe(600_000);
    expect(backoffMs(5)).toBe(3_600_000);
    expect(backoffMs(6)).toBe(21_600_000);
  });

  it('returns null when attempts exceed MAX_ATTEMPTS', () => {
    expect(backoffMs(MAX_ATTEMPTS + 1)).toBeNull();
  });

  it('MAX_ATTEMPTS is 6', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});
