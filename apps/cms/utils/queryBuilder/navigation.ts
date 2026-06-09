import type { SearchQuery, QueryContentType } from './types';
import { compileQuery } from './compile';

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
  // Unscoped (or unknown type): All Content carries q only — field filters can't survive without a type.
  return { path: '/', query: routeQuery };
}
