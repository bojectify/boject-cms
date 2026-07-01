import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEST_REDIS_URL, getTestRedisUrl } from './redisUrl';

describe('getTestRedisUrl', () => {
  const originalUrl = process.env.INTEGRATION_TEST_REDIS_URL;
  const originalPool = process.env.VITEST_POOL_ID;

  beforeEach(() => {
    delete process.env.INTEGRATION_TEST_REDIS_URL;
    delete process.env.VITEST_POOL_ID;
  });
  afterEach(() => {
    if (originalUrl === undefined)
      delete process.env.INTEGRATION_TEST_REDIS_URL;
    else process.env.INTEGRATION_TEST_REDIS_URL = originalUrl;
    if (originalPool === undefined) delete process.env.VITEST_POOL_ID;
    else process.env.VITEST_POOL_ID = originalPool;
  });

  it('defaults to local DB 1 when the override is unset', () => {
    expect(getTestRedisUrl()).toBe(DEFAULT_TEST_REDIS_URL);
    expect(DEFAULT_TEST_REDIS_URL).toBe('redis://localhost:6379/1');
  });

  it('falls back to the default on an empty-string override', () => {
    process.env.INTEGRATION_TEST_REDIS_URL = '';
    expect(getTestRedisUrl()).toBe(DEFAULT_TEST_REDIS_URL);
  });

  it('honours a non-empty override', () => {
    process.env.INTEGRATION_TEST_REDIS_URL = 'redis://example:6380/2';
    expect(getTestRedisUrl()).toBe('redis://example:6380/2');
  });

  it('points at logical DB 1 + id when in a worker', () => {
    process.env.VITEST_POOL_ID = '3';
    expect(getTestRedisUrl()).toBe('redis://localhost:6379/4');
  });
});
