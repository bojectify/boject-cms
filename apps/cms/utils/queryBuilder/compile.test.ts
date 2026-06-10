import { describe, it, expect } from 'vitest';
import { compileQuery, routeToSearchQuery, isSearchMode } from './compile';
import type { SearchQuery } from './types';

describe('compileQuery', () => {
  it('omits everything for an empty query', () => {
    expect(compileQuery({ filters: [] })).toEqual({});
  });

  it('compiles q + contentType + equality filters to /api/search params', () => {
    const q: SearchQuery = {
      contentType: 'Article',
      q: 'playoff',
      filters: [
        { field: 'status', op: 'eq', value: 'Active' },
        { field: 'featured', op: 'eq', value: true },
      ],
    };
    expect(compileQuery(q)).toEqual({
      q: 'playoff',
      contentType: 'Article',
      filter: ['status:eq:Active', 'featured:eq:true'],
    });
  });

  it('stringifies non-string values and drops empty q/filters', () => {
    expect(
      compileQuery({
        q: '',
        filters: [{ field: 'readTime', op: 'eq', value: 5 }],
      })
    ).toEqual({
      filter: ['readTime:eq:5'],
    });
  });

  it('compileQuery emits the 3-part field:op:value form', () => {
    const params = compileQuery({
      contentType: 'Article',
      filters: [
        { field: 'author', op: 'neq', value: 'a1' },
        { field: 'readTime', op: 'gt', value: '5' },
        { field: 'title', op: 'eq', value: 'Hello' },
      ],
    });
    expect(params.filter).toEqual([
      'author:neq:a1',
      'readTime:gt:5',
      'title:eq:Hello',
    ]);
  });

  it('routeToSearchQuery parses the operator (defaults eq for the 2-part legacy form)', () => {
    const q = routeToSearchQuery(
      { filter: ['author:neq:a1', 'status:published'] },
      'Article'
    );
    expect(q.filters).toEqual([
      { field: 'author', op: 'neq', value: 'a1' },
      { field: 'status', op: 'eq', value: 'published' }, // legacy 2-part → eq
    ]);
  });

  it('preserves colon-bearing values (op token disambiguated against the registry)', () => {
    const q = routeToSearchQuery({ filter: 'startsAt:eq:12:30:00' }, 'Event');
    expect(q.filters).toEqual([
      { field: 'startsAt', op: 'eq', value: '12:30:00' },
    ]);
  });

  it('parseFilter splits multi-value (list) op values into an array; round-trips', () => {
    const q = routeToSearchQuery(
      { filter: ['status:in:a,b', 'tags:containsAny:t1,t2,t3'] },
      'Article'
    );
    expect(q.filters).toEqual([
      { field: 'status', op: 'in', value: ['a', 'b'] },
      { field: 'tags', op: 'containsAny', value: ['t1', 't2', 't3'] },
    ]);
    // serialize → parse identity for a list value
    expect(compileQuery(q).filter).toEqual([
      'status:in:a,b',
      'tags:containsAny:t1,t2,t3',
    ]);
  });

  it('a single-value op keeps a scalar value (no split)', () => {
    const q = routeToSearchQuery({ filter: 'author:neq:a1' }, 'Article');
    expect(q.filters).toEqual([{ field: 'author', op: 'neq', value: 'a1' }]);
  });
});

describe('routeToSearchQuery', () => {
  it('rebuilds a SearchQuery (op forced to eq) from route query + a content-type identifier', () => {
    const out = routeToSearchQuery(
      { q: 'playoff', filter: ['status:Active', 'summary:goal'] },
      'Article'
    );
    expect(out).toEqual({
      contentType: 'Article',
      q: 'playoff',
      filters: [
        { field: 'status', op: 'eq', value: 'Active' },
        { field: 'summary', op: 'eq', value: 'goal' },
      ],
    });
  });

  it('splits on the first colon only (values may contain colons)', () => {
    const out = routeToSearchQuery({ filter: 'summary:a:b' }, undefined);
    expect(out.filters).toEqual([{ field: 'summary', op: 'eq', value: 'a:b' }]);
    expect(out.contentType).toBeUndefined();
  });
});

describe('isSearchMode', () => {
  it('is true when q or filter is present, false otherwise', () => {
    expect(isSearchMode({ q: 'x' })).toBe(true);
    expect(isSearchMode({ filter: 'a:b' })).toBe(true);
    expect(isSearchMode({ filter: [] })).toBe(false);
    expect(isSearchMode({})).toBe(false);
  });
});
