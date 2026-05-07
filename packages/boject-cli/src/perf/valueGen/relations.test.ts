import { describe, expect, it } from 'vitest';
import { rng } from '../prng.js';
import {
  generateRelation,
  generateMultirelation,
  type RelationTargetPool,
} from './relations.js';

const singlePool: RelationTargetPool[] = [
  {
    contentTypeId: 'ct-author',
    contentTypeIdentifier: 'Author',
    entryIds: ['a1', 'a2', 'a3'],
  },
];

const polymorphicPool: RelationTargetPool[] = [
  {
    contentTypeId: 'ct-page',
    contentTypeIdentifier: 'Page',
    entryIds: ['p1', 'p2'],
  },
  {
    contentTypeId: 'ct-article',
    contentTypeIdentifier: 'Article',
    entryIds: ['ar1'],
  },
];

describe('generateRelation', () => {
  it('returns a single { contentTypeId, entryId, contentTypeIdentifier } from the pool', () => {
    const v = generateRelation({ rand: rng(1), pool: singlePool });
    expect(v).not.toBeNull();
    expect(v!.contentTypeId).toBe('ct-author');
    expect(v!.contentTypeIdentifier).toBe('Author');
    expect(['a1', 'a2', 'a3']).toContain(v!.entryId);
  });

  it('returns null when the pool is empty', () => {
    expect(generateRelation({ rand: rng(1), pool: [] })).toBeNull();
  });

  it('returns null when all targets in the pool have zero entries', () => {
    const empty: RelationTargetPool[] = [
      { contentTypeId: 'x', contentTypeIdentifier: 'X', entryIds: [] },
    ];
    expect(generateRelation({ rand: rng(1), pool: empty })).toBeNull();
  });

  it('respects polymorphic pools (picks across types)', () => {
    const seen = new Set<string>();
    const r = rng(1); // single threaded PRNG so we get a real distribution
    for (let i = 0; i < 50; i++) {
      const v = generateRelation({ rand: r, pool: polymorphicPool });
      if (v) seen.add(v.contentTypeIdentifier);
    }
    expect(seen.has('Page')).toBe(true);
    expect(seen.has('Article')).toBe(true);
  });
});

describe('generateMultirelation', () => {
  it('returns an array of distinct refs sized in [min, max]', () => {
    const v = generateMultirelation({
      rand: rng(1),
      pool: singlePool,
      fanout: { min: 2, max: 3 },
    });
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v.length).toBeLessThanOrEqual(3);
    const ids = new Set(v.map((r) => r.entryId));
    expect(ids.size).toBe(v.length);
  });

  it('returns an empty array when min=0 and rand picks 0', () => {
    const v = generateMultirelation({
      rand: () => 0,
      pool: singlePool,
      fanout: { min: 0, max: 5 },
    });
    expect(v).toEqual([]);
  });

  it('caps at the available pool size when max exceeds available', () => {
    const v = generateMultirelation({
      rand: () => 0.99,
      pool: singlePool, // 3 entries
      fanout: { min: 0, max: 100 },
    });
    expect(v.length).toBeLessThanOrEqual(3);
  });
});
