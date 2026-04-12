<script setup lang="ts">
const route = useRoute();
const contentTypeId = route.params.id as string;

const page = ref(1);

// Fetch the content type to get the name and ENTRY_TITLE field
const { data: contentType } = await useFetch<{
  id: string;
  name: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
  }>;
}>(`/api/content-types/${contentTypeId}`);

const entryTitleFieldName = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.name ?? 'title';
});

// Fetch entries
const { data, status } = await useFetch<{
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
  query: { contentTypeId, page, perPage: 15 },
  watch: [page],
});

// Map entries to ContentTable format (extract entryTitle from JSONB data)
const tableData = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    entryTitle:
      (item.data?.[entryTitleFieldName.value] as string) ?? 'Untitled',
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
);
</script>

<template>
  <ContentTable
    v-model:page="page"
    :title="contentType?.name ?? 'Entries'"
    :data="tableData"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => `/content-types/${contentTypeId}/entries/${row.id}`"
  >
    <template #actions>
      <UButton
        :to="`/content-types/${contentTypeId}/entries/new`"
        icon="i-lucide-plus"
      >
        New Entry
      </UButton>
    </template>
  </ContentTable>
</template>
