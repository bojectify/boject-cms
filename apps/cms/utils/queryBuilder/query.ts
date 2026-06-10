import type { SearchQuery, SearchFilter } from './types';

export function addFilter(q: SearchQuery, f: SearchFilter): SearchQuery {
  return { ...q, filters: [...q.filters, f] };
}

export function removeFilter(q: SearchQuery, index: number): SearchQuery {
  return { ...q, filters: q.filters.filter((_, i) => i !== index) };
}
