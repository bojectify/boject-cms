<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';

const { formatDate } = useContentTable();

const page = ref(1);
const { data, status } = await useFetch<{
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { fields: number; entries: number };
  }>;
  total: number;
}>('/api/content-types', {
  query: { page, perPage: 15 },
  watch: [page],
});

const columns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'fieldCount', header: 'Fields' },
  { accessorKey: 'entryCount', header: 'Entries' },
  { accessorKey: 'updatedAt', header: 'Updated' },
];

const tableData = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    fieldCount: item._count.fields,
    entryCount: item._count.entries,
    updatedAt: item.updatedAt,
  }))
);
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">Content Types</h1>
      <UButton to="/content-types/new" icon="i-lucide-plus">
        New Content Type
      </UButton>
    </div>
    <UTable
      :data="tableData"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #name-cell="{ row }">
        <NuxtLink
          :to="'/content-types/' + row.original.id"
          class="text-primary hover:underline"
        >
          {{ row.original.name }}
        </NuxtLink>
      </template>
      <template #updatedAt-cell="{ row }">
        {{ formatDate(row.original.updatedAt as string) }}
      </template>
    </UTable>
    <div
      v-if="data?.total !== undefined"
      class="flex justify-center border-t border-default pt-4"
    >
      <UPagination
        :page="page"
        :total="data?.total ?? 0"
        :items-per-page="15"
        show-edges
        :sibling-count="1"
        size="lg"
        :disabled="15 >= (data?.total ?? 0)"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>
