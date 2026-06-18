<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';
import { DEFAULT_CONTENT_COLUMNS } from '~/components/content-table/contentTable.columns';
import type { RowLike } from '~/composables/useRowSelection';

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
  refresh: refreshSearch,
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
const archiveFilter = ref<ArchiveFilter>('active');

const afterCursor = computed(() => (route.query.after as string) || undefined);
const beforeCursor = computed(
  () => (route.query.before as string) || undefined
);

function resetCursor() {
  router.replace({
    path: '/',
    query: { ...route.query, after: undefined, before: undefined },
  });
}
watch(archiveFilter, () => resetCursor());

function goNext() {
  if (!data.value?.pageInfo?.endCursor) return;
  router.replace({
    path: '/',
    query: {
      ...route.query,
      after: data.value.pageInfo.endCursor,
      before: undefined,
    },
  });
}
function goPrev() {
  if (!data.value?.pageInfo?.startCursor) return;
  router.replace({
    path: '/',
    query: {
      ...route.query,
      before: data.value.pageInfo.startCursor,
      after: undefined,
    },
  });
}

const {
  data,
  status,
  refresh: refreshBrowse,
} = await useAuthedFetch<{
  items: Array<{ id: string } & Record<string, unknown>>;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}>('/api/all-content', {
  query: {
    perPage: 15,
    archiveFilter,
    after: afterCursor,
    before: beforeCursor,
  },
  watch: [afterCursor, beforeCursor, archiveFilter],
});

const browseColumns: TableColumn<Record<string, unknown>>[] = [
  ...DEFAULT_CONTENT_COLUMNS,
  { accessorKey: 'contentType', header: 'Type' },
];

// One selection model over whichever table is showing (search hits or browse
// rows), plus the matching refresh, so checkboxes + the bulk bar behave the same
// in both modes — the results table makes no browse/search distinction.
const activeRows = computed<RowLike[]>(() =>
  searchMode.value ? searchRows.value : (data.value?.items ?? [])
);
const {
  selection,
  busy: bulkBusy,
  publish: onBulkPublish,
} = useBulkPublish(activeRows, () =>
  searchMode.value ? refreshSearch() : refreshBrowse()
);

const filterOptions: Array<{ label: string; value: ArchiveFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];
</script>

<template>
  <div>
    <template v-if="searchMode">
      <ContentTable
        v-model:page="searchPage"
        title="All Content"
        :data="searchRows"
        :loading="searchLoading"
        :columns="searchColumns"
        :total="searchTotal"
        :row-link="(row) => `/entries/${row.id}`"
        selectable
        :is-selected="selection.isSelected"
        :all-selected="selection.allSelected.value"
        :indeterminate="selection.indeterminate.value"
        @row-select="(e, id, index) => selection.toggle(id, index, e.shiftKey)"
        @select-all="selection.toggleAll"
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
        <template #bulk-bar>
          <BulkActionBar
            :count="selection.count.value"
            :busy="bulkBusy"
            @publish="onBulkPublish"
            @clear="selection.clear"
          />
        </template>
      </ContentTable>
    </template>
    <ContentTable
      v-else
      title="All Content"
      :data="data?.items ?? []"
      :loading="status === 'pending'"
      :columns="browseColumns"
      :page-info="data?.pageInfo"
      :row-link="(row) => `/entries/${row.id}`"
      selectable
      :is-selected="selection.isSelected"
      :all-selected="selection.allSelected.value"
      :indeterminate="selection.indeterminate.value"
      @next="goNext"
      @prev="goPrev"
      @row-select="(e, id, index) => selection.toggle(id, index, e.shiftKey)"
      @select-all="selection.toggleAll"
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
            @click="archiveFilter = opt.value"
          >
            {{ opt.label }}
          </UButton>
        </UFieldGroup>
      </template>
      <template #bulk-bar>
        <BulkActionBar
          :count="selection.count.value"
          :busy="bulkBusy"
          @publish="onBulkPublish"
          @clear="selection.clear"
        />
      </template>
    </ContentTable>
  </div>
</template>
