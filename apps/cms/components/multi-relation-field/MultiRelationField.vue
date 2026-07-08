<script setup lang="ts">
import draggable from 'vuedraggable';
import type { MultiRelationFieldProps } from './multiRelationField.types';
import { QA_MULTI_RELATION_FIELD } from './multiRelationField.config';

const props = withDefaults(defineProps<MultiRelationFieldProps>(), {
  testId: QA_MULTI_RELATION_FIELD.COMPONENT,
});

const emit = defineEmits<{
  add: [];
  edit: [index: number];
  remove: [index: number];
  reorder: [items: Array<{ contentTypeId: string; entryId: string }>];
}>();

const draggableItems = computed({
  get: () => props.items,
  set: (val) => {
    emit(
      'reorder',
      val.map((item) => ({
        contentTypeId: item.contentTypeId,
        entryId: item.entryId,
      }))
    );
  },
});
</script>

<template>
  <div :data-testid="testId">
    <div class="space-y-1.5">
      <draggable
        v-model="draggableItems"
        item-key="entryId"
        handle=".drag-handle"
        animation="150"
        class="space-y-1.5"
      >
        <template #item="{ element: item, index: idx }">
          <div
            class="flex items-center h-14 pl-2 rounded-lg border border-default bg-elevated hover:bg-elevated/50 transition-colors focus-within:ring-2 focus-within:ring-primary-500"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0 size-3.5 mr-2"
              aria-hidden="true"
            />
            <button
              type="button"
              class="flex-1 flex items-center min-w-0 h-full gap-2 cursor-pointer text-left focus:outline-none"
              @click="emit('edit', idx)"
            >
              <div
                class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0"
              >
                <span
                  class="text-xs font-semibold text-blue-700 dark:text-blue-300"
                >
                  {{ item.contentTypeName.charAt(0).toUpperCase() }}
                </span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-highlighted truncate">
                  {{ item.entryTitle || 'Untitled' }}
                </p>
                <p class="text-xs text-muted">{{ item.contentTypeName }}</p>
              </div>
            </button>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Remove entry"
              class="shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
              @click="emit('remove', idx)"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-muted shrink-0 mr-2 pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </template>
      </draggable>
      <button
        type="button"
        class="w-full flex items-center justify-center h-12 rounded-lg border-2 border-dashed border-accented bg-muted gap-2 cursor-pointer hover:border-accented transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        @click="emit('add')"
      >
        <UIcon name="i-lucide-plus" class="size-3.5 text-muted" />
        <span class="text-sm font-medium text-muted">Add entry</span>
      </button>
    </div>
  </div>
</template>
