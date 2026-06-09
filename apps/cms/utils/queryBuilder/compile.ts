import type { SearchQuery, SearchFilter } from './types';

/** The /api/search param shape — also the URL query shape (minus contentType, which rides the path for per-type routes). */
export interface SearchParams {
  q?: string;
  contentType?: string;
  filter?: string[];
}

/** Route query values arrive as string | string[] | undefined. */
export interface RouteQuery {
  q?: string;
  filter?: string | string[];
}

/** SearchQuery → /api/search params. v1 equality only: the operator is dropped (always `eq`). */
export function compileQuery(query: SearchQuery): SearchParams {
  const out: SearchParams = {};
  if (query.q) out.q = query.q;
  if (query.contentType) out.contentType = query.contentType;
  if (query.filters.length) {
    out.filter = query.filters.map((f) => `${f.field}:${String(f.value)}`);
  }
  return out;
}

/** Route query (+ a content-type identifier from the path) → SearchQuery for the palette's modelValue. */
export function routeToSearchQuery(
  routeQuery: RouteQuery,
  contentTypeIdentifier: string | undefined
): SearchQuery {
  const raw = routeQuery.filter
    ? Array.isArray(routeQuery.filter)
      ? routeQuery.filter
      : [routeQuery.filter]
    : [];
  const filters: SearchFilter[] = raw.map((s) => {
    const idx = s.indexOf(':');
    return idx < 0
      ? { field: s, op: 'eq', value: '' }
      : { field: s.slice(0, idx), op: 'eq', value: s.slice(idx + 1) };
  });
  const out: SearchQuery = { filters };
  if (contentTypeIdentifier) out.contentType = contentTypeIdentifier;
  if (routeQuery.q) out.q = routeQuery.q;
  return out;
}

/** The page is in "search mode" (render results, not browse) when the route carries q or a filter. */
export function isSearchMode(routeQuery: RouteQuery): boolean {
  if (routeQuery.q) return true;
  const f = routeQuery.filter;
  return Array.isArray(f) ? f.length > 0 : !!f;
}
