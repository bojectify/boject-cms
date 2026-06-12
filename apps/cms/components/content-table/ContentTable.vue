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
  rowSelect: [event: MouseEvent, id: string, index: number];
  selectAll: [];
}>();

const slots = defineSlots();

const tableSlots = computed(() => {
  const {
    actions: _actions,
    toolbar: _toolbar,
    'bulk-bar': _bulkBar,
    ...rest
  } = slots;
  return rest;
});

const { formatDate, statusColor } = useContentTable();

// `columns`, when provided, is the full column set (the page owns it); otherwise
// the default browse columns. The cell templates below cover every accessorKey
// either set can use — unused ones simply don't render.
const allColumns = computed<TableColumn<Record<string, unknown>>[]>(() => {
  const base = props.columns ?? DEFAULT_CONTENT_COLUMNS;
  // `w-px` shrinks the selection column to hug its checkbox — a table cell can't
  // collapse below its content's min-width, so the other columns absorb the rest.
  return props.selectable
    ? [
        {
          id: 'select',
          enableSorting: false,
          meta: { class: { th: 'w-px', td: 'w-px' } },
        },
        ...base,
      ]
    : base;
});
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
      <template v-if="selectable" #select-header>
        <!--
          Nuxt UI's UCheckbox has no boolean `indeterminate` prop — the partial
          (dash) state is driven by the string `'indeterminate'` in model-value
          (Reka's tri-state). `false`/`true` cover none/all.
        -->
        <UCheckbox
          :model-value="
            indeterminate ? 'indeterminate' : (allSelected ?? false)
          "
          aria-label="Select all rows"
          @click="emit('selectAll')"
        />
      </template>
      <template v-if="selectable" #select-cell="{ row }">
        <!--
          Controlled (one-way :model-value); `@click` is the ONLY state path —
          it captures `shiftKey` for range-select and emits to the page's
          useRowSelection. Keep it `@click`, NOT `@update:model-value`/`@change`:
          Reka's checkbox is a role=checkbox button, so keyboard Space/Enter
          dispatches a synthetic click here too (with shiftKey:false → a plain
          toggle), preserving keyboard a11y. Switching to @change would lose the
          MouseEvent and silently drop shift-range selection.
        -->
        <UCheckbox
          :model-value="
            isSelected ? isSelected(row.original.id as string) : false
          "
          aria-label="Select row"
          @click="
            (e: MouseEvent) =>
              emit('rowSelect', e, row.original.id as string, row.index)
          "
        />
      </template>
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
    <!--
      Sticky bulk-action region. `position: sticky` anchors the bar to the
      bottom of the dashboard panel's scrollport: it floats over the results
      while there's more to scroll and settles below the pagination at the end —
      "sticky based on the table + pagination". Empty (zero-height,
      non-interactive) until the host's BulkActionBar has a selection, so it adds
      no layout otherwise; the bar itself re-enables pointer events.
    -->
    <div
      v-if="$slots['bulk-bar']"
      class="sticky bottom-4 z-20 mt-3 flex justify-center pointer-events-none"
    >
      <slot name="bulk-bar" />
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
