<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

const page = ref(1);

const { data, status } = await useAuthedFetch('/api/content', {
  query: { page, perPage: 15 },
  watch: [page],
});

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'contentType', header: 'Type' },
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
  />
</template>
