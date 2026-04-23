<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

type ArchiveFilter = 'active' | 'archived' | 'all';

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
  <ContentTable
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
