<script setup lang="ts">
import type { RelationFieldProps } from './relationField.types';
import { QA_RELATION_FIELD } from './relationField.config';

const _props = withDefaults(defineProps<RelationFieldProps>(), {
  testId: QA_RELATION_FIELD.COMPONENT,
});

const emit = defineEmits<{
  add: [];
  edit: [];
  remove: [];
}>();
</script>

<template>
  <div class="space-y-2" :data-testid="testId">
    <div class="flex items-center gap-1">
      <span class="text-sm font-medium text-default">
        {{ label }}
      </span>
      <span v-if="required" class="text-sm text-red-500">*</span>
    </div>
    <button
      v-if="!value"
      type="button"
      class="w-full flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-accented bg-muted gap-2 cursor-pointer hover:border-accented transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      @click="emit('add')"
    >
      <UIcon name="i-lucide-plus" class="size-4 text-muted" />
      <span class="text-sm font-medium text-muted">Add entry</span>
    </button>
    <div
      v-else
      class="flex items-center h-14 rounded-lg border border-default bg-elevated hover:bg-accented transition-colors focus-within:ring-2 focus-within:ring-primary-500"
    >
      <button
        type="button"
        class="flex-1 flex items-center min-w-0 h-full gap-3 px-4 cursor-pointer text-left focus:outline-none"
        @click="emit('edit')"
      >
        <div
          class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0"
        >
          <span class="text-xs font-semibold text-blue-700 dark:text-blue-300">
            {{ (contentTypeName ?? '?').charAt(0).toUpperCase() }}
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-highlighted truncate">
            {{ entryTitle ?? 'Untitled' }}
          </p>
          <p class="text-xs text-muted">
            {{ contentTypeName ?? 'Unknown type' }}
          </p>
        </div>
      </button>
      <UButton
        size="xs"
        variant="ghost"
        icon="i-lucide-x"
        aria-label="Remove entry"
        class="shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100 mr-1"
        @click="emit('remove')"
      />
      <UIcon
        name="i-lucide-chevron-right"
        class="size-4 text-muted shrink-0 mr-3 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
