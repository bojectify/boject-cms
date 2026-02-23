<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';

const props = defineProps<{
  title: string;
  data: Record<string, unknown>[];
  loading?: boolean;
  columns?: TableColumn<Record<string, unknown>>[];
}>();

const slots = defineSlots();

const { formatDate, statusColor } = useContentTable();

const allColumns = computed<TableColumn<Record<string, unknown>>[]>(() => [
  { accessorKey: 'entryTitle', header: 'Entry Title' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'updatedAt', header: 'Updated' },
  { accessorKey: 'status', header: 'Status' },
  ...(props.columns ?? []),
]);
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">{{ title }}</h1>
    <UTable :data="data" :columns="allColumns" :loading="loading">
      <template #createdAt-cell="{ row }">
        {{ formatDate(row.original.createdAt as string) }}
      </template>
      <template #updatedAt-cell="{ row }">
        {{ formatDate(row.original.updatedAt as string) }}
      </template>
      <template #status-cell="{ row }">
        <UBadge
          :color="statusColor[row.original.status as string] ?? 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ row.original.status }}
        </UBadge>
      </template>
      <template v-for="(_, name) in slots" :key="name" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </UTable>
  </div>
</template>
