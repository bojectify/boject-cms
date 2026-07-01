import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEST_DATABASE_URL, getTestDatabaseUrl } from './dbUrl';

describe('getTestDatabaseUrl', () => {
  const originalUrl = process.env.INTEGRATION_TEST_DATABASE_URL;
  const originalPool = process.env.VITEST_POOL_ID;

  beforeEach(() => {
    delete process.env.INTEGRATION_TEST_DATABASE_URL;
    delete process.env.VITEST_POOL_ID; // base assertions need "no worker"
  });

  afterEach(() => {
    if (originalUrl === undefined)
      delete process.env.INTEGRATION_TEST_DATABASE_URL;
    else process.env.INTEGRATION_TEST_DATABASE_URL = originalUrl;
    if (originalPool === undefined) delete process.env.VITEST_POOL_ID;
    else process.env.VITEST_POOL_ID = originalPool;
  });

  it('returns the local-dev fallback when the env var is unset', () => {
    expect(getTestDatabaseUrl()).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it('returns the local-dev fallback when the env var is the empty string', () => {
    process.env.INTEGRATION_TEST_DATABASE_URL = '';
    expect(getTestDatabaseUrl()).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it('returns the env override when set', () => {
    process.env.INTEGRATION_TEST_DATABASE_URL =
      'postgresql://ci:ci@db.example.com:6543/ci_test';
    expect(getTestDatabaseUrl()).toBe(
      'postgresql://ci:ci@db.example.com:6543/ci_test'
    );
  });

  it('suffixes the database name with the worker id when in a worker', () => {
    process.env.VITEST_POOL_ID = '2';
    expect(getTestDatabaseUrl()).toBe(`${DEFAULT_TEST_DATABASE_URL}_2`);
  });

  it('worker-suffixes an INTEGRATION_TEST_DATABASE_URL override too (CI + parallel)', () => {
    process.env.INTEGRATION_TEST_DATABASE_URL =
      'postgresql://ci:ci@db.example.com:6543/ci_test';
    process.env.VITEST_POOL_ID = '3';
    expect(getTestDatabaseUrl()).toBe(
      'postgresql://ci:ci@db.example.com:6543/ci_test_3'
    );
  });
});
