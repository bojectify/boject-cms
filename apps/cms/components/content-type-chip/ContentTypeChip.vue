<script setup lang="ts">
import type { ContentTypeChipProps } from './contentTypeChip.types';
import { QA_CONTENT_TYPE_CHIP } from './contentTypeChip.config';

withDefaults(defineProps<ContentTypeChipProps>(), {
  testId: QA_CONTENT_TYPE_CHIP.COMPONENT,
});
const emit = defineEmits<{ remove: [] }>();
</script>

<template>
  <div
    :data-testid="testId"
    class="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg bg-elevated border border-default shrink-0"
  >
    <UIcon v-if="locked" name="i-lucide-pin" class="size-3 text-dimmed" />
    <span class="text-[13px] font-semibold text-highlighted">{{ name }}</span>
    <button
      type="button"
      aria-label="Remove content type"
      class="text-dimmed hover:text-highlighted"
      @click="emit('remove')"
    >
      <UIcon name="i-lucide-x" class="size-3" />
    </button>
  </div>
</template>
