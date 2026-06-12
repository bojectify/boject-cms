<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';
import { DEFAULT_CONTENT_COLUMNS } from '~/components/content-table/contentTable.columns';

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

// Hits → ContentTable rows. Cross-type, so the Type column is shown.
const searchRows = computed(() =>
  hits.value.map((h) => ({
    id: h.id,
    entryTitle: h.entryTitle,
    snippet: h.snippet,
    status: h.status,
    contentType: h.contentType,
  }))
);
const searchColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'entryTitle', header: 'Entry Title' },
  { accessorKey: 'contentType', header: 'Type' },
  { accessorKey: 'status', header: 'Status' },
];

function onClear() {
  router.push({ path: '/', query: {} });
}
function onRemoveFilter(index: number) {
  const next: SearchQuery = {
    ...searchQuery.value,
    filters: searchQuery.value.filters.filter((_, i) => i !== index),
  };
  const params = compileQuery(next);
  // Keep the remaining filters (mirrors the per-type page) — unscoped URLs can
  // legitimately carry filters, e.g. system fields like $entryKey (#315).
  const query: Record<string, string | string[]> = {};
  if (params.q) query.q = params.q;
  if (params.filter) query.filter = params.filter;
  router.push({ path: '/', query });
}

// --- Browse mode (existing behaviour) ---
const page = ref(1);
const archiveFilter = ref<ArchiveFilter>('active');

watch(archiveFilter, () => {
  page.value = 1;
});

const { data, status } = await useAuthedFetch('/api/content', {
  query: { page, perPage: 15, archiveFilter },
  watch: [page, archiveFilter],
});

const browseColumns: TableColumn<Record<string, unknown>>[] = [
  ...DEFAULT_CONTENT_COLUMNS,
  { accessorKey: 'contentType', header: 'Type' },
];

const filterOptions: Array<{ label: string; value: ArchiveFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];
</script>

<template>
  <ContentTable
    v-if="searchMode"
    v-model:page="searchPage"
    title="All Content"
    :data="searchRows"
    :loading="searchLoading"
    :columns="searchColumns"
    :total="searchTotal"
    :row-link="(row) => `/entries/${row.id}`"
  >
    <template #toolbar>
      <SearchBar
        :query="searchQuery"
        @edit="open()"
        @clear="onClear"
        @remove-filter="onRemoveFilter"
      />
    </template>
    <template #empty>
      <div class="flex flex-col items-center gap-2 py-10 text-center">
        <UIcon
          :name="unavailable ? 'i-lucide-search-x' : 'i-lucide-search'"
          class="size-8 text-dimmed"
        />
        <p class="text-highlighted font-medium">
          {{
            unavailable
              ? 'Search is temporarily unavailable'
              : 'No matching entries'
          }}
        </p>
        <p class="text-sm text-muted">
          {{
            unavailable
              ? 'The search service is down. Clear search to keep browsing.'
              : 'Try removing a filter or broadening your search.'
          }}
        </p>
      </div>
    </template>
  </ContentTable>
  <ContentTable
    v-else
    v-model:page="page"
    title="All Content"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :columns="browseColumns"
    :total="data?.total ?? 0"
    :row-link="(row) => `/entries/${row.id}`"
  >
    <template #toolbar>
      <SearchBar placeholder="Search all content…" @open="open" />
    </template>
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
