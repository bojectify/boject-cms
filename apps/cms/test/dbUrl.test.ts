import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEST_DATABASE_URL, getTestDatabaseUrl } from './dbUrl';

describe('getTestDatabaseUrl', () => {
  const original = process.env.INTEGRATION_TEST_DATABASE_URL;

  beforeEach(() => {
    delete process.env.INTEGRATION_TEST_DATABASE_URL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.INTEGRATION_TEST_DATABASE_URL;
    } else {
      process.env.INTEGRATION_TEST_DATABASE_URL = original;
    }
  });

  it('returns the local-dev fallback when the env var is unset', () => {
    expect(getTestDatabaseUrl()).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it('returns the env override when set', () => {
    process.env.INTEGRATION_TEST_DATABASE_URL =
      'postgresql://ci:ci@db.example.com:6543/ci_test';
    expect(getTestDatabaseUrl()).toBe(
      'postgresql://ci:ci@db.example.com:6543/ci_test'
    );
  });
});
