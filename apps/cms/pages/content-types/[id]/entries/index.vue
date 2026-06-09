<script setup lang="ts">
import { routeToSearchQuery, compileQuery } from '~/utils/queryBuilder/compile';
import type { RouteQuery } from '~/utils/queryBuilder/compile';
import type { SearchQuery } from '~/utils/queryBuilder/types';

type ArchiveFilter = 'active' | 'archived' | 'all';

const route = useRoute();
const router = useRouter();
const { open } = useSearchPalette();
const contentTypeId = route.params.id as string;

// Content type: name + identifier + ENTRY_TITLE field
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
} = useEntrySearch(() => contentType.value?.identifier);

const searchQuery = computed<SearchQuery>(() =>
  routeToSearchQuery(route.query as RouteQuery, contentType.value?.identifier)
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

// --- Browse mode (existing behaviour, unchanged) ---
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
  <SearchResults
    v-if="searchMode"
    v-model:page="searchPage"
    :query="searchQuery"
    :content-type-name="contentType?.name"
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
    :title="contentType?.name ?? 'Entries'"
    :data="tableData"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => `/entries/${row.id}`"
  >
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
</template>
