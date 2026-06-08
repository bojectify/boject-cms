import type { MaybeRefOrGetter } from 'vue';
import { isSearchMode } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';

interface SearchHit {
  id: string;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  snippet: string | null;
  publishedAt: string | null;
}
interface SearchResponse {
  hits: SearchHit[];
  total: number;
  page: number;
  perPage: number;
}

/**
 * SSR-safe /api/search fetch keyed on the route. Only fires in search mode (q or
 * filter present), so browse pages never hit it. A 503 surfaces as `unavailable`
 * (graceful degradation — never a thrown 500). `contentType` is the scoped type's
 * identifier (undefined on All Content → cross-type search).
 */
export function useEntrySearch(
  contentType: MaybeRefOrGetter<string | undefined>
) {
  const route = useRoute();
  const page = ref(1);

  const searchMode = computed(() => isSearchMode(route.query as RouteQuery));

  // Reset to page 1 when the query itself changes (not on page changes).
  watch(
    () => [route.query.q, route.query.filter],
    () => {
      page.value = 1;
    }
  );

  const { data, status, error, execute } = useAuthedFetch<SearchResponse>(
    '/api/search',
    {
      query: computed(() => ({
        q: route.query.q,
        contentType: toValue(contentType),
        filter: route.query.filter,
        page: page.value,
        perPage: 15,
      })),
      watch: [page],
      immediate: searchMode.value,
    }
  );

  // Refetch on soft navigation that lands in (or moves within) search mode.
  watch(
    () => route.fullPath,
    () => {
      if (searchMode.value) execute();
    }
  );

  const unavailable = computed(
    () => (error.value as { statusCode?: number } | null)?.statusCode === 503
  );

  return {
    searchMode,
    hits: computed(() => data.value?.hits ?? []),
    total: computed(() => data.value?.total ?? 0),
    loading: computed(() => status.value === 'pending'),
    unavailable,
    page,
  };
}
