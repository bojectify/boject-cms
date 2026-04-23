<script setup lang="ts">
type ArchiveFilter = 'active' | 'archived' | 'all';

const route = useRoute();
const contentTypeId = route.params.id as string;

const page = ref(1);
const archiveFilter = ref<ArchiveFilter>('active');

// Reset to page 1 when filter changes
watch(archiveFilter, () => {
  page.value = 1;
});

// Fetch the content type to get the name and ENTRY_TITLE field
const { data: contentType } = await useAuthedFetch<{
  id: string;
  name: string;
  fields: Array<{
    identifier: string;
    name: string;
    type: string;
  }>;
}>(`/api/content-types/${contentTypeId}`);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.identifier ?? 'title';
});

// Fetch entries
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

// Map entries to ContentTable format (extract entryTitle from JSONB data)
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
  <ContentTable
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
