import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveWorkerId,
  resolveMaxTestWorkers,
  suffixDatabaseUrl,
  suffixRedisUrl,
  suffixMeiliIndex,
  resolveTestMeiliIndex,
  staleWorkerNames,
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
  it('returns null when VITEST_POOL_ID is truly unset (deleted)', () => {
    vi.stubEnv('VITEST_POOL_ID', undefined);
    expect(resolveWorkerId()).toBeNull();
  });
  it('returns null for a zero / negative / non-integer pool id', () => {
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      vi.stubEnv('VITEST_POOL_ID', bad);
      expect(resolveWorkerId()).toBeNull();
    }
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

describe('resolveTestMeiliIndex', () => {
  it('returns the base index when not in a worker', () => {
    vi.stubEnv('VITEST_POOL_ID', undefined);
    expect(resolveTestMeiliIndex()).toBe('entries_test');
  });
  it('suffixes the base index with the worker id in a worker', () => {
    vi.stubEnv('VITEST_POOL_ID', '2');
    expect(resolveTestMeiliIndex()).toBe('entries_test_2');
  });
});

describe('staleWorkerNames', () => {
  it('returns names whose numeric id exceeds keep', () => {
    const names = [
      'boject_test',
      'boject_test_1',
      'boject_test_2',
      'boject_test_5',
      'boject_test_10',
    ];
    expect(staleWorkerNames(names, 'boject_test_', 2)).toEqual([
      'boject_test_5',
      'boject_test_10',
    ]);
  });
  it('never matches the unsuffixed base or unrelated / non-numeric names', () => {
    const names = [
      'boject_test',
      'boject', // dev DB
      'boject_perf_test',
      'postgres',
      'boject_test_x',
    ];
    expect(staleWorkerNames(names, 'boject_test_', 1)).toEqual([]);
  });
  it('works with a hyphen-separated dir prefix', () => {
    const names = ['.nuxt-test-1', '.nuxt-test-3', '.nuxt', 'src'];
    expect(staleWorkerNames(names, '.nuxt-test-', 1)).toEqual(['.nuxt-test-3']);
  });
});
