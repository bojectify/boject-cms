import type { MaybeRefOrGetter } from 'vue';
import { isSearchMode } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';

interface SearchHit {
  id: string;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  status: string;
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
 *
 * Pagination lives in the route (`?page=N`), so a deep result is shareable and
 * reloads to the same page server-side.
 */
export function useEntrySearch(
  contentType: MaybeRefOrGetter<string | undefined>
) {
  const route = useRoute();
  const router = useRouter();

  const searchMode = computed(() => isSearchMode(route.query as RouteQuery));

  // The page is the route's single source of truth: clamped to >= 1, omitted
  // from the URL at page 1. Changing q/filter navigates without a `page` param
  // (planNavigation / the pages' clear+removeFilter only carry q/filter), so the
  // page naturally resets to 1 — no separate reset watcher needed.
  const page = computed<number>({
    get: () => Math.max(1, Number(route.query.page) || 1),
    set: (p) => {
      const query = { ...route.query };
      if (p > 1) query.page = String(p);
      else delete query.page;
      router.replace({ path: route.path, query });
    },
  });

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
      // Refetches are driven solely by the route watcher below (guarded by
      // searchMode) — not useFetch's implicit query watch — so browse pages
      // never fire /api/search and every refetch goes through one path.
      watch: false,
      immediate: searchMode.value,
    }
  );

  // Any route change that is (or moves into) search mode refetches — covers
  // q / filter / page changes and soft navigation into search mode.
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
    refresh: () => execute(),
  };
}
