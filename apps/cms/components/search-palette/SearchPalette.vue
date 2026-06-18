<script setup lang="ts">
import type { SearchPaletteProps } from './searchPalette.types';
import {
  QA_SEARCH_PALETTE,
  SEARCH_PALETTE_MODAL_CONTENT_UI,
} from './searchPalette.config';
import type { SearchQuery, QueryContentType } from '~/utils/queryBuilder/types';
import type { EntryOption } from '~/components/query-builder/queryBuilder.types';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import { routeToSearchQuery } from '~/utils/queryBuilder/compile';

withDefaults(defineProps<SearchPaletteProps>(), {
  testId: QA_SEARCH_PALETTE.COMPONENT,
});

const route = useRoute();
const { isOpen, open, close, navigate } = useSearchPalette();

defineShortcuts({ meta_k: () => open() });

const { data: ctData } = await useAuthedFetch<{ items: QueryContentType[] }>(
  '/api/content-types/with-fields',
  { key: 'search-content-types' }
);
const contentTypes = computed(() => ctData.value?.items ?? []);

const lockedContentType = computed<QueryContentType | undefined>(() => {
  const m = route.path.match(/^\/content-types\/([^/]+)\/entries/);
  if (!m) return undefined;
  return contentTypes.value.find((c) => c.id === m[1]);
});

const initialQuery = computed<SearchQuery>(() =>
  routeToSearchQuery(
    route.query as RouteQuery,
    lockedContentType.value?.identifier
  )
);

const { relationLabels, pending: relationLabelsPending } = useFilterChipLabels(
  () => initialQuery.value,
  () => lockedContentType.value?.fields ?? []
);

async function searchEntries(
  targetContentTypeIds: string[],
  q: string
): Promise<EntryOption[]> {
  // Fetch per target content type from /api/entries (UUID-keyed). We already
  // hold both the id and the display name in `contentTypes`, so there's no
  // identifier round-trip and no reliance on the response carrying the type name.
  const targets = targetContentTypeIds
    .map((id) => contentTypes.value.find((c) => c.id === id))
    .filter((c): c is QueryContentType => !!c);
  const lists = await Promise.all(
    targets.map((ct) =>
      $fetch<{ items: Array<{ id: string; entryTitle: string }> }>(
        '/api/entries',
        {
          query: {
            contentTypeId: ct.id,
            perPage: 50,
            archiveFilter: 'active',
          },
        }
      )
        .then((res) => ({ name: ct.name, items: res.items }))
        .catch(() => ({ name: ct.name, items: [] }))
    )
  );
  const needle = q.toLowerCase();
  return lists
    .flatMap((l) => l.items.map((entry) => ({ entry, name: l.name })))
    .filter(
      ({ entry }) => !needle || entry.entryTitle.toLowerCase().includes(needle)
    )
    .map(({ entry, name }) => ({
      id: entry.id,
      entryTitle: entry.entryTitle,
      contentTypeName: name,
    }));
}

function onRun(query: SearchQuery) {
  navigate(query, contentTypes.value);
}

function onBroaden(payload: { q?: string }) {
  navigate({ q: payload.q, filters: [] }, contentTypes.value);
}
</script>

<template>
  <UModal
    :data-testid="testId"
    :open="isOpen"
    :overlay="true"
    :close="false"
    :content="{ onOpenAutoFocus: (e: Event) => e.preventDefault() }"
    :ui="{ content: SEARCH_PALETTE_MODAL_CONTENT_UI }"
    @update:open="
      (v: boolean) => {
        if (!v) close();
      }
    "
  >
    <template #content>
      <QueryBuilder
        v-if="isOpen"
        :key="route.fullPath"
        :test-id="QA_SEARCH_PALETTE.MODAL"
        :content-types="contentTypes"
        :locked-content-type="lockedContentType"
        :model-value="initialQuery"
        :enable-rich-operators="true"
        :enable-multi-value-operators="true"
        :enable-range-operators="true"
        :relation-labels="relationLabels"
        :relation-labels-pending="relationLabelsPending"
        :search-entries="searchEntries"
        @run="onRun"
        @broaden="onBroaden"
      />
    </template>
  </UModal>
</template>
