<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';

const page = ref(1);

const { data, status } = await useFetch('/api/fixtures', {
  query: { page, perPage: 15 },
  watch: [page],
});

const { formatDate } = useContentTable();

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'kickoff', header: 'Kickoff' },
  { accessorKey: 'venue', header: 'Venue' },
];
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Fixtures"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :columns="columns"
    :total="data?.total ?? 0"
    :row-link="(row) => '/fixtures/' + row.id"
  >
    <template #kickoff-cell="{ row }">
      {{ formatDate(row.original.kickoff as string) }}
    </template>
  </ContentTable>
</template>
