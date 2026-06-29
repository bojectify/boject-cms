import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';
import {
  stableStringify,
  buildCacheKey,
  buildTags,
} from './graphqlCachePlugin';

describe('stableStringify', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(
      stableStringify({ b: 2, a: 1 })
    );
  });
  it('sorts nested keys', () => {
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe('{"x":{"p":1,"q":2}}');
  });
});

describe('buildCacheKey', () => {
  it('is stable across whitespace/formatting differences', () => {
    const a = parse('{ articleList { edges { node { id } } } }');
    const b = parse(`{
      articleList {
        edges { node { id } }
      }
    }`);
    expect(buildCacheKey(a, {}, null)).toBe(buildCacheKey(b, {}, null));
  });
  it('is stable across variable key order', () => {
    const doc = parse('query Q($a: ID!, $b: ID!) { article(id: $a) { id } }');
    expect(buildCacheKey(doc, { a: '1', b: '2' }, 'Q')).toBe(
      buildCacheKey(doc, { b: '2', a: '1' }, 'Q')
    );
  });
  it('differs when variables differ', () => {
    const doc = parse('query Q($a: ID!) { article(id: $a) { id } }');
    expect(buildCacheKey(doc, { a: '1' }, 'Q')).not.toBe(
      buildCacheKey(doc, { a: '2' }, 'Q')
    );
  });
  it('is prefixed with gql:', () => {
    const doc = parse('{ articleList { edges { node { id } } } }');
    expect(buildCacheKey(doc, {}, null).startsWith('gql:')).toBe(true);
  });
});

describe('buildTags', () => {
  const map = new Map([
    ['ct-article', 'Article'],
    ['ct-author', 'Author'],
  ]);

  it('emits content-type + entry tags per pair, collapsing the content-type tag across same-type entries', () => {
    const collected = new Set<string>([
      'ct-article\0a1',
      'ct-author\0au1',
      // A second, DISTINCT Article entry — this is what exercises buildTags'
      // inner-Set dedup of the shared `content-type:Article` tag (two different
      // members can't collapse at Set construction, unlike a repeated member).
      'ct-article\0a2',
    ]);
    const tags = buildTags(collected, map);
    expect(tags.sort()).toEqual(
      [
        'content-type:Article',
        'content-type:Author',
        'entry:Article:a1',
        'entry:Article:a2',
        'entry:Author:au1',
      ].sort()
    );
    // The shared content-type tag must appear exactly once across both Articles.
    expect(tags.filter((t) => t === 'content-type:Article')).toHaveLength(1);
  });

  it('skips pairs whose contentTypeId is not in the map', () => {
    const collected = new Set<string>(['ct-unknown\0some-id']);
    expect(buildTags(collected, map)).toEqual([]);
  });

  it('returns [] for an empty collection', () => {
    expect(buildTags(new Set(), map)).toEqual([]);
  });
});
