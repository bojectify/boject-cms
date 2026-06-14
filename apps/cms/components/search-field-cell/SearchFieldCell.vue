<script setup lang="ts">
import { useContentTable } from '~/composables/useContentTable';
import { formatColumnValue, EMPTY_CELL } from '~/utils/searchColumns';
import type { SearchFieldCellProps } from './searchFieldCell.types';
import { QA_SEARCH_FIELD_CELL } from './searchFieldCell.config';

const props = withDefaults(defineProps<SearchFieldCellProps>(), {
  testId: QA_SEARCH_FIELD_CELL.COMPONENT,
});

const { formatDate } = useContentTable();

const display = computed(() =>
  formatColumnValue(props.value, props.fieldType, formatDate)
);
</script>

<template>
  <span
    :data-testid="testId"
    :title="display === EMPTY_CELL ? undefined : display"
    class="block max-w-[20rem] truncate text-sm"
    :class="display === EMPTY_CELL ? 'text-dimmed' : 'text-default'"
  >
    {{ display }}
  </span>
</template>
