import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit, resetRateLimitStore } from './rateLimit';

describe('rateLimit snapshot fields', () => {
  beforeEach(() => resetRateLimitStore());
  afterEach(() => vi.useRealTimers());

  it('returns full snapshot on an empty bucket', () => {
    const result = rateLimit('test:1', 5, 60_000);
    expect(result).toEqual({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetSeconds: 60,
      retryAfterMs: 0,
    });
  });

  it('decrements remaining on each admitted request', () => {
    const cap = 5;
    for (let i = 0; i < cap; i++) {
      const result = rateLimit('test:2', cap, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(cap - 1 - i);
    }
  });

  it('reports remaining=0 and allowed=false when over cap', () => {
    const cap = 3;
    for (let i = 0; i < cap; i++) {
      rateLimit('test:3', cap, 60_000);
    }
    const denied = rateLimit('test:3', cap, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.resetSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.resetSeconds).toBeLessThanOrEqual(60);
  });

  it('resets snapshot after the window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
    const cap = 2;
    rateLimit('test:4', cap, 1_000);
    rateLimit('test:4', cap, 1_000);
    expect(rateLimit('test:4', cap, 1_000).allowed).toBe(false);

    vi.advanceTimersByTime(1_100);
    const result = rateLimit('test:4', cap, 1_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(cap - 1);
  });
});
