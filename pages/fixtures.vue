<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';

const { data: fixtures, status } = await useFetch('/api/fixtures');
const { formatDate } = useContentTable();

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'kickoff', header: 'Kickoff' },
  { accessorKey: 'venue', header: 'Venue' },
];
</script>

<template>
  <ContentTable
    title="Fixtures"
    :data="fixtures ?? []"
    :loading="status === 'pending'"
    :columns="columns"
  >
    <template #kickoff-cell="{ row }">
      {{ formatDate(row.original.kickoff as string) }}
    </template>
  </ContentTable>
</template>
