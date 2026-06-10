import { describe, it, expect } from 'vitest';
import { addFilter, removeFilter } from './query';
import type { SearchQuery } from './types';

const base: SearchQuery = {
  contentType: 'Article',
  q: 'playoff',
  filters: [
    { field: 'status', op: 'eq', value: 'Active' },
    { field: 'summary', op: 'eq', value: 'final' },
  ],
};

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
