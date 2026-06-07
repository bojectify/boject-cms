import { describe, it, expect } from 'vitest';
import { serializeQuery, parseQuery, addFilter, removeFilter } from './query';
import type { SearchQuery } from './types';

const base: SearchQuery = {
  contentType: 'Article',
  q: 'playoff',
  filters: [
    { field: 'status', op: 'eq', value: 'Active' },
    { field: 'summary', op: 'eq', value: 'final' },
  ],
};

describe('query serialization', () => {
  it('round-trips a scoped query through route params', () => {
    const params = serializeQuery(base);
    expect(params).toEqual({
      contentType: 'Article',
      q: 'playoff',
      filter: ['status:eq:Active', 'summary:eq:final'],
    });
    expect(parseQuery(params)).toEqual(base);
  });

  it('omits empty parts for an unscoped free-text query', () => {
    expect(serializeQuery({ q: 'hello', filters: [] })).toEqual({ q: 'hello' });
  });

  it('tolerates a single filter string (not an array) on parse', () => {
    const q = parseQuery({
      contentType: 'Article',
      filter: 'status:eq:Active',
    });
    expect(q.filters).toEqual([{ field: 'status', op: 'eq', value: 'Active' }]);
  });
});

describe('filter mutation (immutable)', () => {
  it('addFilter appends without mutating the input', () => {
    const q: SearchQuery = { contentType: 'Article', filters: [] };
    const next = addFilter(q, { field: 'status', op: 'eq', value: 'Active' });
    expect(next.filters).toHaveLength(1);
    expect(q.filters).toHaveLength(0);
  });
  it('removeFilter drops by index', () => {
    expect(removeFilter(base, 0).filters.map((f) => f.field)).toEqual([
      'summary',
    ]);
  });
});
