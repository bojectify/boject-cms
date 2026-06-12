<script setup lang="ts">
import type { BulkActionBarProps } from './bulkActionBar.types';
import { QA_BULK_ACTION_BAR } from './bulkActionBar.config';

withDefaults(defineProps<BulkActionBarProps>(), {
  busy: false,
  testId: QA_BULK_ACTION_BAR.COMPONENT,
});
const emit = defineEmits<{ publish: []; clear: [] }>();
</script>

<template>
  <Transition name="bulk-bar">
    <div
      v-if="count > 0"
      :data-testid="testId"
      class="pointer-events-auto flex w-full max-w-3xl items-center gap-3.5 rounded-xl border border-default bg-default px-4 py-2.5 shadow-[0_10px_30px_rgba(26,26,46,0.2)]"
      role="region"
      aria-label="Bulk actions"
    >
      <span
        :data-testid="QA_BULK_ACTION_BAR.COUNT"
        class="text-sm font-bold text-highlighted"
      >
        {{ count }} selected
      </span>
      <div class="h-5 shrink-0 border-l border-default" />
      <UButton
        :data-testid="QA_BULK_ACTION_BAR.PUBLISH_BUTTON"
        color="primary"
        icon="i-lucide-check"
        class="rounded-lg"
        :loading="busy"
        :disabled="busy"
        @click="emit('publish')"
      >
        Publish
      </UButton>
      <div class="grow" />
      <UButton
        :data-testid="QA_BULK_ACTION_BAR.CLEAR_BUTTON"
        color="neutral"
        variant="ghost"
        class="rounded-lg"
        :disabled="busy"
        @click="emit('clear')"
      >
        Clear selection
      </UButton>
    </div>
  </Transition>
</template>

<style scoped>
.bulk-bar-enter-active,
.bulk-bar-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.bulk-bar-enter-from,
.bulk-bar-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
