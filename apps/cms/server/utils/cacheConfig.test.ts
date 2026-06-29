import { describe, it, expect } from 'vitest';
import {
  assertCacheConfigured,
  resolvePublicCacheTtl,
  DEFAULT_PUBLIC_CACHE_TTL,
  resolveGraphqlCacheMaxBytes,
  DEFAULT_GRAPHQL_CACHE_MAX_BYTES,
} from './cacheConfig';

describe('assertCacheConfigured', () => {
  it('throws in production when redisUrl is unset', () => {
    expect(() =>
      assertCacheConfigured({ nodeEnv: 'production', redisUrl: undefined })
    ).toThrow(/REDIS_URL must be set in production/);
  });

  it('does not throw in production when redisUrl is set', () => {
    expect(() =>
      assertCacheConfigured({
        nodeEnv: 'production',
        redisUrl: 'redis://localhost:6379',
      })
    ).not.toThrow();
  });

  it('does not throw in development with redisUrl unset', () => {
    expect(() =>
      assertCacheConfigured({ nodeEnv: 'development', redisUrl: undefined })
    ).not.toThrow();
  });

  it('does not throw in test with redisUrl unset', () => {
    expect(() =>
      assertCacheConfigured({ nodeEnv: 'test', redisUrl: undefined })
    ).not.toThrow();
  });
});

describe('resolvePublicCacheTtl', () => {
  it('defaults to 3600 when raw is undefined', () => {
    expect(resolvePublicCacheTtl(undefined)).toBe(3600);
    expect(DEFAULT_PUBLIC_CACHE_TTL).toBe(3600);
  });

  it('returns a valid positive number', () => {
    expect(resolvePublicCacheTtl('600')).toBe(600);
  });

  it('falls back to 3600 for zero, negative, and non-numeric input', () => {
    expect(resolvePublicCacheTtl('0')).toBe(3600);
    expect(resolvePublicCacheTtl('-5')).toBe(3600);
    expect(resolvePublicCacheTtl('abc')).toBe(3600);
    expect(resolvePublicCacheTtl('')).toBe(3600);
  });
});

describe('resolveGraphqlCacheMaxBytes', () => {
  it('defaults when unset', () => {
    expect(resolveGraphqlCacheMaxBytes(undefined)).toBe(
      DEFAULT_GRAPHQL_CACHE_MAX_BYTES
    );
  });
  it('uses a positive override', () => {
    expect(resolveGraphqlCacheMaxBytes('2048')).toBe(2048);
  });
  it('falls back on non-numeric / zero / negative', () => {
    expect(resolveGraphqlCacheMaxBytes('abc')).toBe(
      DEFAULT_GRAPHQL_CACHE_MAX_BYTES
    );
    expect(resolveGraphqlCacheMaxBytes('0')).toBe(
      DEFAULT_GRAPHQL_CACHE_MAX_BYTES
    );
    expect(resolveGraphqlCacheMaxBytes('-5')).toBe(
      DEFAULT_GRAPHQL_CACHE_MAX_BYTES
    );
    expect(resolveGraphqlCacheMaxBytes('')).toBe(
      DEFAULT_GRAPHQL_CACHE_MAX_BYTES
    );
  });
});
