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
      filter: ['status:Active', 'featured:true'],
    });
  });

  it('stringifies non-string values and drops empty q/filters', () => {
    expect(
      compileQuery({
        q: '',
        filters: [{ field: 'readTime', op: 'eq', value: 5 }],
      })
    ).toEqual({
      filter: ['readTime:5'],
    });
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
