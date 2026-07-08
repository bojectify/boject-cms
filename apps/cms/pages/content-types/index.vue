<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';

const { formatDate } = useContentTable();
const schemaReadonly = useSchemaReadonly();

const page = ref(1);
const { data, status } = await useAuthedFetch<{
  items: Array<{
    id: string;
    name: string;
    identifier: string;
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
  { accessorKey: 'identifier', header: 'Identifier' },
  { accessorKey: 'fieldCount', header: 'Fields' },
  { accessorKey: 'entryCount', header: 'Entries' },
  { accessorKey: 'updatedAt', header: 'Updated' },
];

const tableData = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    identifier: item.identifier,
    fieldCount: item._count.fields,
    entryCount: item._count.entries,
    updatedAt: item.updatedAt,
  }))
);

// Whole-row click → the content-type editor, mirroring ContentTable's rows.
// Binding onSelect makes UTable tag each <tr> role="button" + data-selectable
// (free hover:bg-elevated/50, light + dark); the name <a> is auto-excluded from
// the row click by UTable's guard, so it keeps its cmd-click / new-tab powers.
function openContentType(
  _event: Event,
  row: { original: Record<string, unknown> }
) {
  navigateTo(`/content-types/${row.original.id as string}`);
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">Content Types</h1>
      <UButton
        v-if="!schemaReadonly"
        to="/content-types/new"
        icon="i-lucide-plus"
      >
        New Content Type
      </UButton>
    </div>
    <UAlert
      v-if="schemaReadonly"
      color="info"
      icon="i-lucide-lock"
      title="Schema is read-only on this environment"
      description="Edit in dev and deploy via git."
      class="mb-4"
    />
    <UTable
      :data="tableData"
      :columns="columns"
      :loading="status === 'pending'"
      :ui="{ tr: 'cursor-pointer' }"
      @select="openContentType"
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
