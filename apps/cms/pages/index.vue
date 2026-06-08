<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';

type ArchiveFilter = 'active' | 'archived' | 'all';

const route = useRoute();
const router = useRouter();
const { open } = useSearchPalette();

// --- Search mode (cross-type: no scoped content type) ---
const {
  searchMode,
  hits,
  total: searchTotal,
  loading: searchLoading,
  unavailable,
  page: searchPage,
} = useEntrySearch(() => undefined);

const searchQuery = computed<SearchQuery>(() =>
  routeToSearchQuery(route.query as RouteQuery, undefined)
);

function onClear() {
  router.push({ path: '/', query: {} });
}
function onRemoveFilter(index: number) {
  const next: SearchQuery = {
    ...searchQuery.value,
    filters: searchQuery.value.filters.filter((_, i) => i !== index),
  };
  const params = compileQuery(next);
  router.push({ path: '/', query: { ...(params.q ? { q: params.q } : {}) } });
}

// --- Browse mode (existing behaviour, unchanged) ---
const page = ref(1);
const archiveFilter = ref<ArchiveFilter>('active');

watch(archiveFilter, () => {
  page.value = 1;
});

const { data, status } = await useAuthedFetch('/api/content', {
  query: { page, perPage: 15, archiveFilter },
  watch: [page, archiveFilter],
});

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'contentType', header: 'Type' },
];

const filterOptions: Array<{ label: string; value: ArchiveFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];
</script>

<template>
  <SearchResults
    v-if="searchMode"
    v-model:page="searchPage"
    :query="searchQuery"
    :hits="hits"
    :total="searchTotal"
    :loading="searchLoading"
    :unavailable="unavailable"
    @edit="open()"
    @clear="onClear"
    @remove-filter="onRemoveFilter"
  />
  <ContentTable
    v-else
    v-model:page="page"
    title="All Content"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :columns="columns"
    :total="data?.total ?? 0"
    :row-link="(row) => `/entries/${row.id}`"
  >
    <template #actions>
      <UFieldGroup>
        <UButton
          v-for="opt in filterOptions"
          :key="opt.value"
          :color="archiveFilter === opt.value ? 'primary' : 'neutral'"
          :variant="archiveFilter === opt.value ? 'solid' : 'outline'"
          size="sm"
          @click="archiveFilter = opt.value"
        >
          {{ opt.label }}
        </UButton>
      </UFieldGroup>
    </template>
  </ContentTable>
</template>
