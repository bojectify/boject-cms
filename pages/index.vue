<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

const page = ref(1);

const { data, status } = await useFetch('/api/content', {
  query: { page, perPage: 15 },
  watch: [page],
});

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'contentType', header: 'Type' },
];
</script>

<template>
  <div>
    <ContentTable
      title="All Content"
      :data="data?.items ?? []"
      :loading="status === 'pending'"
      :columns="columns"
    />
    <div class="flex justify-center border-t border-default pt-4">
      <UPagination
        v-model:page="page"
        :total="data?.total ?? 0"
        :items-per-page="15"
        show-edges
        :sibling-count="1"
      />
    </div>
  </div>
</template>
