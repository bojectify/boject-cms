import type { SearchQuery, SearchFilter } from './types';
import { isOperatorId, operatorArity } from './operators';

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

/**
 * Serialize one filter to its `field:op:value` URL token. `value` is stringified
 * one-way, so a `serialize`→`parse` round-trip is an identity only for the value
 * shape `parseFilter` returns (string for scalar ops, string[] for list ops);
 * typed coercion by field type (number/boolean/etc.) is the consumer's job (the
 * value editor / machine). Arity-many values (in / containsAny / containsAll)
 * rely on `Array.prototype.toString` comma-joining here to match the server's
 * comma-split (parseFilters in search.get.ts) — and to round-trip with
 * `parseFilter` below.
 */
export function serializeFilter(f: SearchFilter): string {
  return `${f.field}:${f.op}:${String(f.value ?? '')}`;
}

/**
 * Parse one URL filter token. Accepts the 3-part `field:op:value` form and the
 * legacy 2-part `field:value` form (→ eq). The middle token is the operator
 * only when it is a registered operator id (closed-set disambiguation), so a
 * colon-bearing value is preserved and a 2-part token defaults to eq. Mirrors
 * the server-side parseFilters in search.get.ts (kept separate — server layer).
 */
export function parseFilter(s: string): SearchFilter {
  const firstColon = s.indexOf(':');
  if (firstColon < 0) return { field: s, op: 'eq', value: '' };
  const field = s.slice(0, firstColon);
  const rest = s.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  if (secondColon > 0) {
    const maybeOp = rest.slice(0, secondColon);
    if (isOperatorId(maybeOp)) {
      const raw = rest.slice(secondColon + 1);
      // List ops carry comma-separated values; comma is the delimiter, so a
      // value cannot itself contain a literal comma (known limit, see #332).
      const value = operatorArity(maybeOp) === 'one' ? raw : raw.split(',');
      return { field, op: maybeOp, value };
    }
  }
  return { field, op: 'eq', value: rest };
}

/** SearchQuery → /api/search params. Filters serialize to the `field:op:value` URL form. */
export function compileQuery(query: SearchQuery): SearchParams {
  const out: SearchParams = {};
  if (query.q) out.q = query.q;
  if (query.contentType) out.contentType = query.contentType;
  if (query.filters.length) {
    out.filter = query.filters.map(serializeFilter);
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
  const filters: SearchFilter[] = raw.map(parseFilter);
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
