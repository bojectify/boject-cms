import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CLI_TEST_DATABASE_URL,
  getCliTestDatabaseUrl,
} from '../integration/dbUrl';

describe('getCliTestDatabaseUrl', () => {
  const original = process.env.CLI_INTEGRATION_TEST_DATABASE_URL;

  beforeEach(() => {
    delete process.env.CLI_INTEGRATION_TEST_DATABASE_URL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLI_INTEGRATION_TEST_DATABASE_URL;
    } else {
      process.env.CLI_INTEGRATION_TEST_DATABASE_URL = original;
    }
  });

  it('returns the local-dev fallback when the env var is unset', () => {
    expect(getCliTestDatabaseUrl()).toBe(DEFAULT_CLI_TEST_DATABASE_URL);
  });

  it('returns the env override when set', () => {
    process.env.CLI_INTEGRATION_TEST_DATABASE_URL =
      'postgresql://ci:ci@db.example.com:6543/ci_perf_test';
    expect(getCliTestDatabaseUrl()).toBe(
      'postgresql://ci:ci@db.example.com:6543/ci_perf_test'
    );
  });
});
