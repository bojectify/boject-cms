import type { SearchQuery } from '~/utils/queryBuilder/types';
import type { ChipLabelField } from '~/utils/queryBuilder/chipLabels';
import { collectRelationFilterIds } from '~/utils/queryBuilder/chipLabels';

// GET /api/content-entries/:id is flattened (flattenEntryWithVersion), so the
// resolved entry title is already top-level — no need to re-scan fields.
interface ChipEntryResponse {
  entryTitle?: string | null;
}

function entryTitleOf(entry: ChipEntryResponse): string | null {
  return entry.entryTitle ?? null;
}

/**
 * Resolves a search query's RELATION/MULTIRELATION filter ids to entry titles
 * for chip display. Backed by useAsyncData: SSR-rendered (no id flash on cold
 * load), status-driven `pending` (drives the chip skeleton on client
 * transitions), shared by key across the palette + summary bar (dedup), and
 * degrades to the id when an entry can't be loaded.
 */
export function useFilterChipLabels(
  query: () => SearchQuery | undefined,
  fields: () => ChipLabelField[]
) {
  const request$fetch = useRequestFetch();
  const ids = computed(() => collectRelationFilterIds(query(), fields()));

  const { data, status } = useAsyncData(
    'filter-chip-relation-titles',
    async () => {
      // No relation filters (e.g. every non-search route, since SearchPalette
      // is global) → nothing to resolve, no fetch.
      if (ids.value.length === 0) return {};
      const results = await Promise.all(
        ids.value.map((id) =>
          request$fetch<ChipEntryResponse>(`/api/content-entries/${id}`)
            .then((entry) => [id, entryTitleOf(entry)] as const)
            .catch(() => null)
        )
      );
      const map: Record<string, string> = {};
      for (const r of results) if (r && r[1]) map[r[0]] = r[1];
      return map;
    },
    { watch: [ids], default: () => ({}) }
  );

  return {
    relationLabels: computed(() => data.value ?? {}),
    pending: computed(() => status.value === 'pending'),
  };
}
