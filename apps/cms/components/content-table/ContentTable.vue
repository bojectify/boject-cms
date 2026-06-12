<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useContentTable } from '~/composables/useContentTable';
import type { ContentTableProps } from './contentTable.types';
import { QA_CONTENT_TABLE } from './contentTable.config';
import { DEFAULT_CONTENT_COLUMNS } from './contentTable.columns';
import { highlightToSafeHtml } from '~/utils/searchSnippet';

const props = withDefaults(defineProps<ContentTableProps>(), {
  testId: QA_CONTENT_TABLE.COMPONENT,
});

const emit = defineEmits<{
  'update:page': [value: number];
}>();

const slots = defineSlots();

const tableSlots = computed(() => {
  const { actions: _actions, toolbar: _toolbar, ...rest } = slots;
  return rest;
});

const { formatDate, statusColor } = useContentTable();

// `columns`, when provided, is the full column set (the page owns it); otherwise
// the default browse columns. The cell templates below cover every accessorKey
// either set can use — unused ones simply don't render.
const allColumns = computed<TableColumn<Record<string, unknown>>[]>(
  () => props.columns ?? DEFAULT_CONTENT_COLUMNS
);
</script>

<template>
  <div class="p-6" :data-testid="testId">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">{{ title }}</h1>
      <slot name="actions" />
    </div>
    <!-- Toolbar row (e.g. the search launcher bar) sits below the header,
         above the table — per the search design. -->
    <div v-if="$slots.toolbar" class="mb-4">
      <slot name="toolbar" />
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
        <!-- A search hit carries a highlighted snippet; browse rows don't. -->
        <!-- eslint-disable vue/no-v-html -- sanitised by highlightToSafeHtml -->
        <p
          v-if="row.original.snippet"
          class="text-sm text-muted search-snippet mt-0.5"
          v-html="highlightToSafeHtml(row.original.snippet as string)"
        />
        <!-- eslint-enable vue/no-v-html -->
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

<style scoped>
@reference '~/assets/css/main.css';

/* Search-snippet highlight: <em> tokens come from Meili's match cropping
   (highlightToSafeHtml). Render upright with a soft amber wash using the
   semantic `warning` utilities; @reference pulls the theme so they resolve in
   this scoped block (mirrors RichTextEditor). */
.search-snippet :deep(em) {
  @apply not-italic bg-warning/15 text-warning rounded-xs px-px;
}
</style>
