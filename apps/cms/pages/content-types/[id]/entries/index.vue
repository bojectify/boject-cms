<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';

type ArchiveFilter = 'active' | 'archived' | 'all';

const route = useRoute();
const router = useRouter();
const { open } = useSearchPalette();
const contentTypeId = route.params.id as string;

// Content type: name + identifier + fields (fields drive the summary chip labels)
const { data: contentType } = await useAuthedFetch<{
  id: string;
  identifier: string;
  name: string;
  fields: Array<{ identifier: string; name: string; type: string }>;
}>(`/api/content-types/${contentTypeId}`);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find(
    (f) => f.type === FIELD_TYPES.ENTRY_TITLE
  );
  return field?.identifier ?? 'title';
});

// --- Search mode (scoped to this type) ---
const {
  searchMode,
  hits,
  total: searchTotal,
  loading: searchLoading,
  unavailable,
  page: searchPage,
  refresh: refreshSearch,
} = useEntrySearch(() => contentType.value?.identifier);

const searchQuery = computed<SearchQuery>(() =>
  routeToSearchQuery(route.query as RouteQuery, contentType.value?.identifier)
);

const { relationLabels: chipRelationLabels, pending: chipLabelsPending } =
  useFilterChipLabels(
    () => searchQuery.value,
    () => contentType.value?.fields ?? []
  );

// Hits → ContentTable rows. Scoped, so no Type column (all one type).
const searchRows = computed(() =>
  hits.value.map((h) => ({
    id: h.id,
    entryTitle: h.entryTitle,
    snippet: h.snippet,
    status: h.status,
  }))
);
const searchColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'entryTitle', header: 'Entry Title' },
  { accessorKey: 'status', header: 'Status' },
];

const {
  selection,
  busy: bulkBusy,
  publish: onBulkPublish,
} = useBulkPublish(searchRows, refreshSearch);

function onClear() {
  router.push({ path: `/content-types/${contentTypeId}/entries`, query: {} });
}
function onRemoveFilter(index: number) {
  const next: SearchQuery = {
    ...searchQuery.value,
    filters: searchQuery.value.filters.filter((_, i) => i !== index),
  };
  const params = compileQuery(next);
  const query: Record<string, string | string[]> = {};
  if (params.q) query.q = params.q;
  if (params.filter) query.filter = params.filter;
  router.push({ path: `/content-types/${contentTypeId}/entries`, query });
}

// --- Browse mode (existing behaviour) ---
const page = ref(1);
const archiveFilter = ref<ArchiveFilter>('active');
watch(archiveFilter, () => {
  page.value = 1;
});

const { data, status } = await useAuthedFetch<{
  items: Array<{
    id: string;
    data: Record<string, unknown>;
    slug: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}>('/api/content-entries', {
  query: { contentTypeId, page, perPage: 15, archiveFilter },
  watch: [page, archiveFilter],
});

const tableData = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    entryTitle:
      (item.data?.[entryTitleFieldIdentifier.value] as string) ?? 'Untitled',
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
);

const filterOptions: Array<{ label: string; value: ArchiveFilter }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: 'all' },
];
</script>

<template>
  <div :class="{ 'pb-28': selection.count.value > 0 }">
    <template v-if="searchMode">
      <ContentTable
        v-model:page="searchPage"
        :title="contentType?.name ?? 'Entries'"
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
            :content-type-name="contentType?.name"
            :fields="contentType?.fields ?? []"
            :relation-labels="chipRelationLabels"
            :relation-labels-pending="chipLabelsPending"
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
      <BulkActionBar
        :count="selection.count.value"
        :busy="bulkBusy"
        @publish="onBulkPublish"
        @clear="selection.clear"
      />
    </template>
    <ContentTable
      v-else
      v-model:page="page"
      :title="contentType?.name ?? 'Entries'"
      :data="tableData"
      :loading="status === 'pending'"
      :total="data?.total ?? 0"
      :row-link="(row) => `/entries/${row.id}`"
    >
      <template #toolbar>
        <SearchBar
          :placeholder="`Search ${contentType?.name ?? 'entries'}…`"
          @open="open"
        />
      </template>
      <template #actions>
        <div class="flex items-center gap-2">
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
          <UButton :to="`/entries/new:${contentTypeId}`" icon="i-lucide-plus">
            New Entry
          </UButton>
        </div>
      </template>
    </ContentTable>
  </div>
</template>
