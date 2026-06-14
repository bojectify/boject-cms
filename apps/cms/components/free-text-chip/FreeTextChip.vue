<script setup lang="ts">
import type { FreeTextChipProps } from './freeTextChip.types';
import { QA_FREE_TEXT_CHIP } from './freeTextChip.config';

withDefaults(defineProps<FreeTextChipProps>(), {
  testId: QA_FREE_TEXT_CHIP.COMPONENT,
});
const emit = defineEmits<{ edit: []; remove: [] }>();
</script>

<template>
  <!--
    The committed free-text query (`query.q`) as a chip — click the label to
    edit it (chip → input), ✕ to clear it. Mirrors FilterChip's segmented look:
    inline-flex + shrink-0 hugs the chip inside the search bar's flex row.
  -->
  <div
    :data-testid="testId"
    class="inline-flex shrink-0 items-stretch h-7 rounded-lg border border-default text-xs"
  >
    <button
      type="button"
      :data-testid="QA_FREE_TEXT_CHIP.EDIT_BUTTON"
      class="px-2 flex items-center gap-1.5 rounded-l-[7px] text-highlighted"
      @click="emit('edit')"
    >
      <UIcon name="i-lucide-search" class="size-3 text-dimmed" />
      <span class="font-medium">{{ '“' + value + '”' }}</span>
    </button>
    <div class="w-px self-stretch bg-default" />
    <button
      type="button"
      aria-label="Remove search term"
      :data-testid="QA_FREE_TEXT_CHIP.REMOVE_BUTTON"
      class="px-1.5 flex items-center rounded-r-[7px] text-dimmed hover:text-highlighted"
      @click="emit('remove')"
    >
      <UIcon name="i-lucide-x" class="size-3" />
    </button>
  </div>
</template>
