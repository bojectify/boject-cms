<script setup lang="ts">
import type { SearchPaletteProps } from './searchPalette.types';
import { QA_SEARCH_PALETTE } from './searchPalette.config';
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
  // /api/content filters on the content-type IDENTIFIER, not its id — resolve
  // each target id via the loaded content types so the picker is scoped.
  const identifiers = targetContentTypeIds
    .map((id) => contentTypes.value.find((c) => c.id === id)?.identifier)
    .filter((identifier): identifier is string => !!identifier);
  const lists = await Promise.all(
    identifiers.map((identifier) =>
      $fetch<{
        items: Array<{ id: string; entryTitle: string; contentType: string }>;
      }>('/api/content', {
        query: {
          contentType: identifier,
          perPage: 50,
          archiveFilter: 'active',
        },
      }).catch(() => ({ items: [] }))
    )
  );
  const needle = q.toLowerCase();
  return lists
    .flatMap((l) => l.items)
    .filter((e) => !needle || e.entryTitle.toLowerCase().includes(needle))
    .map((e) => ({
      id: e.id,
      entryTitle: e.entryTitle,
      contentTypeName: e.contentType,
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
    :ui="{
      content:
        'top-[12vh] sm:top-[12vh] translate-y-0 bg-transparent ring-0 shadow-none rounded-none divide-y-0 overflow-visible w-[calc(100vw-2rem)] max-w-2xl',
    }"
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
        :enable-multi-value-operators="false"
        :relation-labels="relationLabels"
        :relation-labels-pending="relationLabelsPending"
        :search-entries="searchEntries"
        @run="onRun"
        @broaden="onBroaden"
      />
    </template>
  </UModal>
</template>
