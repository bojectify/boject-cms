<script setup lang="ts">
import type { SearchBarProps } from './searchBar.types';
import { QA_SEARCH_BAR } from './searchBar.config';

withDefaults(defineProps<SearchBarProps>(), {
  testId: QA_SEARCH_BAR.COMPONENT,
  placeholder: 'Search…',
});
defineEmits<{ open: [] }>();
</script>

<template>
  <!--
    A persistent launcher: an input-styled button above the table. It does not
    own the query surface — clicking it (or ⌘K) opens the command palette.
  -->
  <button
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
