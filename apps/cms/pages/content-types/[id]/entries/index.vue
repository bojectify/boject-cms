<script setup lang="ts">
import { h } from 'vue';
import type { TableColumn } from '@nuxt/ui';
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';
import type { RowLike } from '~/composables/useRowSelection';
import SearchFieldCell from '~/components/search-field-cell/SearchFieldCell.vue';
import { DEFAULT_CONTENT_COLUMNS } from '~/components/content-table/contentTable.columns';
import { isColumnableFieldType, serializeColumns } from '~/utils/searchColumns';
import type { FieldTypeName } from '~/utils/fieldTypes';

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
  columns: activeColumnIds,
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
  hits.value.map((hit) => ({
    id: hit.id,
    entryTitle: hit.entryTitle,
    snippet: hit.snippet,
    status: hit.status,
    fields: hit.fields,
  }))
);

// Fields offerable as data-grid columns (columnable types, in content-type order).
const columnableFields = computed(() =>
  (contentType.value?.fields ?? []).filter(
    (f): f is { identifier: string; name: string; type: FieldTypeName } =>
      isColumnableFieldType(f.type)
  )
);

// The active columns, resolved to their field defs (URL order; unknown ids dropped).
const activeFieldColumns = computed(() =>
  activeColumnIds.value
    .map((id) => columnableFields.value.find((f) => f.identifier === id))
    .filter((f): f is NonNullable<typeof f> => !!f)
);

function onColumnsChange(ids: string[]) {
  const query = { ...route.query };
  if (ids.length) query.columns = serializeColumns(ids);
  else delete query.columns;
  router.replace({ path: route.path, query });
}

const fieldColumnDefs = computed<TableColumn<Record<string, unknown>>[]>(() =>
  activeFieldColumns.value.map((field) => ({
    id: `field_${field.identifier}`,
    header: field.name,
    cell: ({ row }: { row: { original: Record<string, unknown> } }) =>
      h(SearchFieldCell, {
        value: (row.original.fields as Record<string, unknown> | undefined)?.[
          field.identifier
        ],
        fieldType: field.type,
      }),
  }))
);

const searchColumns = computed<TableColumn<Record<string, unknown>>[]>(() => [
  { accessorKey: 'entryTitle', header: 'Entry Title' },
  ...fieldColumnDefs.value,
  { accessorKey: 'status', header: 'Status' },
]);

// Browse columns = Entry Title, then field columns, then the default Created /
// Updated / Status (same field-column injection as search).
const browseColumns = computed<TableColumn<Record<string, unknown>>[]>(() => [
  DEFAULT_CONTENT_COLUMNS[0]!, // Entry Title
  ...fieldColumnDefs.value,
  ...DEFAULT_CONTENT_COLUMNS.slice(1), // Created, Updated, Status
]);

const searchSubtitle = computed(() =>
  searchMode.value ? `${searchTotal.value} matching entries` : undefined
);

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
const archiveFilter = ref<ArchiveFilter>('active');

const afterCursor = computed(() => (route.query.after as string) || undefined);
const beforeCursor = computed(
  () => (route.query.before as string) || undefined
);

function resetCursor() {
  const q = { ...route.query };
  delete q.after;
  delete q.before;
  router.replace({ path: route.path, query: q });
}
watch(archiveFilter, () => resetCursor());

function goNext() {
  if (!data.value?.pageInfo?.endCursor) return;
  router.replace({
    path: route.path,
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
    path: route.path,
    query: {
      ...route.query,
      before: data.value.pageInfo.startCursor,
      after: undefined,
    },
  });
}

const browseColumnsParam = computed(() => route.query.columns);

const {
  data,
  status,
  refresh: refreshBrowse,
} = await useAuthedFetch<{
  items: Array<{
    id: string;
    data: Record<string, unknown>;
    slug: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    fields?: Record<string, unknown>;
  }>;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}>('/api/entries', {
  query: {
    contentTypeId,
    perPage: 15,
    archiveFilter,
    after: afterCursor,
    before: beforeCursor,
    columns: browseColumnsParam,
  },
  watch: [afterCursor, beforeCursor, archiveFilter, browseColumnsParam],
});

const tableData = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    entryTitle:
      (item.data?.[entryTitleFieldIdentifier.value] as string) ?? 'Untitled',
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    fields: item.fields,
  }))
);

// One selection model over whichever table is showing (search hits or browse
// rows), plus the matching refresh, so checkboxes + the bulk bar behave the same
// in both modes — the results table makes no browse/search distinction.
const activeRows = computed<RowLike[]>(() =>
  searchMode.value ? searchRows.value : tableData.value
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
        :title="contentType?.name ?? 'Entries'"
        :subtitle="searchSubtitle"
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
        <template #actions>
          <SearchColumnPicker
            v-if="contentType"
            :content-type-identifier="contentType.identifier"
            :fields="columnableFields"
            :model-value="activeColumnIds"
            @update:model-value="onColumnsChange"
          />
        </template>
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
      :title="contentType?.name ?? 'Entries'"
      :data="tableData"
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
        <SearchBar
          :placeholder="`Search ${contentType?.name ?? 'entries'}…`"
          @open="open"
        />
      </template>
      <template #actions>
        <div class="flex items-center gap-2">
          <SearchColumnPicker
            v-if="contentType"
            :content-type-identifier="contentType.identifier"
            :fields="columnableFields"
            :model-value="activeColumnIds"
            @update:model-value="onColumnsChange"
          />
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
          <UButton :to="`/entries/new:${contentTypeId}`" icon="i-lucide-plus">
            New Entry
          </UButton>
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
  </div>
</template>
