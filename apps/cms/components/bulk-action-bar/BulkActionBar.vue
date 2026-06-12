<script setup lang="ts">
import type { BulkActionBarProps } from './bulkActionBar.types';
import { QA_BULK_ACTION_BAR } from './bulkActionBar.config';

const props = withDefaults(defineProps<BulkActionBarProps>(), {
  busy: false,
  testId: QA_BULK_ACTION_BAR.COMPONENT,
});
const emit = defineEmits<{ publish: []; clear: [] }>();
</script>

<template>
  <Transition name="bulk-bar">
    <div
      v-if="props.count > 0"
      :data-testid="testId"
      class="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-3 rounded-full border border-default bg-default px-4 py-2.5 shadow-xl"
      role="region"
      aria-label="Bulk actions"
    >
      <span
        :data-testid="QA_BULK_ACTION_BAR.COUNT"
        class="text-sm font-medium text-highlighted"
      >
        {{ props.count }} selected
      </span>
      <UButton
        :data-testid="QA_BULK_ACTION_BAR.PUBLISH_BUTTON"
        color="primary"
        size="sm"
        icon="i-lucide-upload"
        :loading="props.busy"
        @click="emit('publish')"
      >
        Publish
      </UButton>
      <UButton
        :data-testid="QA_BULK_ACTION_BAR.CLEAR_BUTTON"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="props.busy"
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
