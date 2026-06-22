import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEST_REDIS_URL, getTestRedisUrl } from './redisUrl';

describe('getTestRedisUrl', () => {
  const original = process.env.INTEGRATION_TEST_REDIS_URL;

  beforeEach(() => {
    delete process.env.INTEGRATION_TEST_REDIS_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INTEGRATION_TEST_REDIS_URL;
    else process.env.INTEGRATION_TEST_REDIS_URL = original;
  });

  it('defaults to local DB 1 when the override is unset', () => {
    expect(getTestRedisUrl()).toBe(DEFAULT_TEST_REDIS_URL);
    expect(DEFAULT_TEST_REDIS_URL).toBe('redis://localhost:6379/1');
  });

  it('falls back to the default on an empty-string override (docker-compose passthrough)', () => {
    process.env.INTEGRATION_TEST_REDIS_URL = '';
    expect(getTestRedisUrl()).toBe(DEFAULT_TEST_REDIS_URL);
  });

  it('honours a non-empty override', () => {
    process.env.INTEGRATION_TEST_REDIS_URL = 'redis://example:6380/2';
    expect(getTestRedisUrl()).toBe('redis://example:6380/2');
  });
});
