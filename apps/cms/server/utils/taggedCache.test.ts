import { describe, expect, it } from 'vitest';
import { assertRedisInstance } from './taggedCache';

describe('assertRedisInstance', () => {
  it('returns the instance when it carries redis set ops', () => {
    const fake = { smembers() {}, sadd() {} };
    expect(assertRedisInstance(fake)).toBe(fake);
  });

  it('throws a descriptive error when the instance lacks set ops', () => {
    expect(() => assertRedisInstance({})).toThrow(/not redis-backed/);
    expect(() => assertRedisInstance(undefined)).toThrow(/not redis-backed/);
    // A driver with only SOME ops (e.g. a partial stub) is still rejected.
    expect(() => assertRedisInstance({ smembers() {} })).toThrow(
      /not redis-backed/
    );
  });
});
