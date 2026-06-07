import type { SearchQuery, SearchFilter } from './types';

export type RouteParams = {
  contentType?: string;
  q?: string;
  filter?: string | string[];
};

export function serializeQuery(query: SearchQuery): RouteParams {
  const params: RouteParams = {};
  if (query.contentType) params.contentType = query.contentType;
  if (query.q) params.q = query.q;
  if (query.filters.length) {
    params.filter = query.filters.map(
      (f) => `${f.field}:${f.op}:${String(f.value)}`
    );
  }
  return params;
}

export function parseQuery(params: RouteParams): SearchQuery {
  const raw = params.filter
    ? Array.isArray(params.filter)
      ? params.filter
      : [params.filter]
    : [];
  const filters: SearchFilter[] = raw.map((s) => {
    const [field = '', op = '', ...rest] = s.split(':');
    return { field, op, value: rest.join(':') };
  });
  const out: SearchQuery = { filters };
  if (params.contentType) out.contentType = params.contentType;
  if (params.q) out.q = params.q;
  return out;
}

export function addFilter(q: SearchQuery, f: SearchFilter): SearchQuery {
  return { ...q, filters: [...q.filters, f] };
}

export function removeFilter(q: SearchQuery, index: number): SearchQuery {
  return { ...q, filters: q.filters.filter((_, i) => i !== index) };
}
