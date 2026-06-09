<script setup lang="ts">
import type { SearchBarProps } from './searchBar.types';
import { QA_SEARCH_BAR } from './searchBar.config';
import {
  chipFieldName,
  chipOperatorLabel,
  chipValueDisplay,
} from '~/utils/queryBuilder/chipLabels';

const props = withDefaults(defineProps<SearchBarProps>(), {
  testId: QA_SEARCH_BAR.COMPONENT,
  placeholder: 'Search…',
});
defineEmits<{
  open: [];
  edit: [];
  clear: [];
  removeFilter: [index: number];
}>();

// ContentTypeChip / FilterChip are auto-registered.
const fields = computed(() => props.fields ?? []);
</script>

<template>
  <!--
    Summary mode: the read-only active query. Chips wrap (no overflow); field /
    operator labels come from the shared chipLabels helpers (relation values
    still show the id until the resolution follow-up lands).
  -->
  <div
    v-if="query"
    :data-testid="testId"
    class="flex items-center flex-wrap gap-2 w-full min-h-11 px-3 py-2 rounded-lg border border-default bg-default"
  >
    <UIcon name="i-lucide-search" class="size-[18px] text-dimmed shrink-0" />
    <ContentTypeChip
      v-if="contentTypeName"
      :name="contentTypeName"
      @remove="$emit('clear')"
    />
    <FilterChip
      v-for="(f, i) in query.filters"
      :key="i"
      :field="chipFieldName(fields, f.field)"
      :operator="chipOperatorLabel(fields, f)"
      :value="chipValueDisplay(f.value)"
      :test-id="QA_SEARCH_BAR.FILTER_CHIP(i)"
      @remove="$emit('removeFilter', i)"
    />
    <span v-if="query.q" class="text-sm text-muted">“{{ query.q }}”</span>
    <div class="ml-auto flex items-center gap-2">
      <UButton
        :data-testid="QA_SEARCH_BAR.EDIT"
        size="sm"
        variant="ghost"
        icon="i-lucide-pencil"
        @click="$emit('edit')"
      >
        Edit <UKbd value="meta" /><UKbd value="k" />
      </UButton>
      <UButton
        :data-testid="QA_SEARCH_BAR.CLEAR"
        size="sm"
        variant="outline"
        @click="$emit('clear')"
      >
        Clear search
      </UButton>
    </div>
  </div>

  <!--
    Launcher mode: an input-styled button above the table. It does not own the
    query surface — clicking it (or ⌘K) opens the command palette.
  -->
  <button
    v-else
    type="button"
    :data-testid="testId"
    class="flex items-center gap-3 w-full h-11 px-3.5 rounded-lg border border-default bg-default text-left transition-colors hover:border-accented"
    @click="$emit('open')"
  >
    <UIcon name="i-lucide-search" class="size-[18px] text-dimmed shrink-0" />
    <span class="flex-1 text-[15px] text-dimmed truncate">{{
      placeholder
    }}</span>
    <span class="flex items-center gap-1 shrink-0">
      <UKbd value="meta" />
      <UKbd value="k" />
    </span>
  </button>
</template>
