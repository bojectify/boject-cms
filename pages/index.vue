<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

const { data: content, status } = await useFetch('/api/content');

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'contentType', header: 'Type' },
];
</script>

<template>
  <ContentTable
    title="Recent Content"
    :data="content ?? []"
    :loading="status === 'pending'"
    :columns="columns"
  />
</template>
