import type { SearchQuery, QueryContentType } from './types';
import { compileQuery, serializeFilter } from './compile';
import { getSystemField } from './systemFields';

export interface NavigationPlan {
  path: string;
  query: Record<string, string | string[]>;
}

/**
 * Where a run/broaden should navigate. The route is the source of truth for scope:
 * a known content type → its per-type path (id in the path); otherwise All Content.
 * `contentType` rides the path, so it is stripped from the query.
 */
export function planNavigation(
  query: SearchQuery,
  contentTypes: QueryContentType[]
): NavigationPlan {
  const params = compileQuery(query);
  const scoped = params.contentType
    ? contentTypes.find((c) => c.identifier === params.contentType)
    : undefined;

  const routeQuery: Record<string, string | string[]> = {};
  if (params.q) routeQuery.q = params.q;

  if (scoped) {
    if (params.filter) routeQuery.filter = params.filter;
    return { path: `/content-types/${scoped.id}/entries`, query: routeQuery };
  }
  // Unscoped (or unknown type): content-type FIELD filters can't survive
  // without a type, but system-field filters target envelope attributes that
  // exist on every document — those carry over to All Content (#315).
  const systemFilters = query.filters.filter((f) => getSystemField(f.field));
  if (systemFilters.length) {
    routeQuery.filter = systemFilters.map(serializeFilter);
  }
  return { path: '/', query: routeQuery };
}
