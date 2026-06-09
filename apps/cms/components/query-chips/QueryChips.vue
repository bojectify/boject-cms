<script setup lang="ts">
import type { QueryChipsProps } from './queryChips.types';
import type { ChipSegment } from '~/components/filter-chip/filterChip.types';
import { QA_QUERY_CHIPS } from './queryChips.config';
import {
  chipFieldName,
  chipOperatorLabel,
  chipValueDisplay,
} from '~/utils/queryBuilder/chipLabels';

defineProps<QueryChipsProps>();
const emit = defineEmits<{
  removeContentType: [];
  removeFilter: [index: number];
  editSegment: [index: number, segment: ChipSegment];
}>();

// ContentTypeChip / FilterChip are auto-registered (Nuxt + Storybook scan components/).
</script>

<template>
  <!--
    A multi-root fragment: the content-type chip + committed filter chips render
    as DIRECT children of the consumer's flex row (no wrapper box), so spacing and
    order match the inline markup this replaces. The consumer interleaves its own
    draft chip / value input after this component (QueryBuilder), or its free-text
    span + Edit/Clear (SearchBar).
  -->
  <ContentTypeChip
    v-if="contentTypeName"
    :name="contentTypeName"
    :locked="locked"
    :test-id="QA_QUERY_CHIPS.CONTENT_TYPE_CHIP"
    @remove="emit('removeContentType')"
  />
  <template v-for="(f, i) in filters" :key="i">
    <FilterChip
      v-if="editingIndex !== i"
      :field="chipFieldName(fields, f.field)"
      :operator="chipOperatorLabel(fields, f)"
      :value="chipValueDisplay(f.value, relationLabels)"
      :test-id="QA_QUERY_CHIPS.FILTER_CHIP(i)"
      @remove="emit('removeFilter', i)"
      @edit-segment="(seg: ChipSegment) => emit('editSegment', i, seg)"
    />
  </template>
</template>
