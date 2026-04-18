<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';
import type { ContentTableProps } from './contentTable.types';
import { QA_CONTENT_TABLE } from './contentTable.config';

const props = withDefaults(defineProps<ContentTableProps>(), {
  testId: QA_CONTENT_TABLE.COMPONENT,
});

const emit = defineEmits<{
  'update:page': [value: number];
}>();

const slots = defineSlots();

const tableSlots = computed(() => {
  const { actions: _, ...rest } = slots;
  return rest;
});

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
  <div class="p-6" :data-testid="testId">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">{{ title }}</h1>
      <slot name="actions" />
    </div>
    <UTable :data="data" :columns="allColumns" :loading="loading">
      <template #entryTitle-cell="{ row }">
        <NuxtLink
          v-if="rowLink"
          :to="rowLink(row.original)"
          class="text-primary hover:underline"
        >
          {{ row.original.entryTitle }}
        </NuxtLink>
        <span v-else>{{ row.original.entryTitle }}</span>
      </template>
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
      <template v-for="(_, name) in tableSlots" :key="name" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </UTable>
    <div
      v-if="total !== undefined"
      class="flex justify-center border-t border-default pt-4"
    >
      <UPagination
        :page="page"
        :total="total"
        :items-per-page="itemsPerPage ?? 15"
        show-edges
        :sibling-count="1"
        size="lg"
        :disabled="(itemsPerPage ?? 15) >= (total ?? 0)"
        @update:page="emit('update:page', $event)"
      />
    </div>
  </div>
</template>
