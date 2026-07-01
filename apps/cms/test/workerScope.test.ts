import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveWorkerId,
  resolveMaxTestWorkers,
  suffixDatabaseUrl,
  suffixRedisUrl,
  suffixMeiliIndex,
} from './workerScope';

afterEach(() => vi.unstubAllEnvs());

describe('resolveWorkerId', () => {
  it('returns null when VITEST_POOL_ID is unset', () => {
    vi.stubEnv('VITEST_POOL_ID', '');
    expect(resolveWorkerId()).toBeNull();
  });
  it('parses a positive integer pool id', () => {
    vi.stubEnv('VITEST_POOL_ID', '3');
    expect(resolveWorkerId()).toBe(3);
  });
});

describe('suffixDatabaseUrl', () => {
  const base = 'postgresql://boject:boject@localhost:5432/boject_test';
  it('returns the base unchanged for a null id', () => {
    expect(suffixDatabaseUrl(base, null)).toBe(base);
  });
  it('suffixes the database name with the worker id', () => {
    expect(suffixDatabaseUrl(base, 2)).toBe(
      'postgresql://boject:boject@localhost:5432/boject_test_2'
    );
  });
});

describe('suffixRedisUrl', () => {
  const base = 'redis://localhost:6379/1';
  it('returns the base unchanged for a null id', () => {
    expect(suffixRedisUrl(base, null)).toBe(base);
  });
  it('points at logical DB 1 + id', () => {
    expect(suffixRedisUrl(base, 1)).toBe('redis://localhost:6379/2');
    expect(suffixRedisUrl(base, 4)).toBe('redis://localhost:6379/5');
  });
});

describe('suffixMeiliIndex', () => {
  it('returns the base unchanged for a null id', () => {
    expect(suffixMeiliIndex('entries_test', null)).toBe('entries_test');
  });
  it('suffixes the index name with the worker id', () => {
    expect(suffixMeiliIndex('entries_test', 3)).toBe('entries_test_3');
  });
});

describe('resolveMaxTestWorkers', () => {
  it('honours a positive TEST_MAX_WORKERS override', () => {
    vi.stubEnv('TEST_MAX_WORKERS', '2');
    expect(resolveMaxTestWorkers()).toBe(2);
  });
  it('clamps the override to the Redis 14-DB ceiling', () => {
    vi.stubEnv('TEST_MAX_WORKERS', '99');
    expect(resolveMaxTestWorkers()).toBe(14);
  });
  it('never returns less than 1 on a zero/invalid override', () => {
    vi.stubEnv('TEST_MAX_WORKERS', '0');
    expect(resolveMaxTestWorkers()).toBeGreaterThanOrEqual(1);
  });
});
