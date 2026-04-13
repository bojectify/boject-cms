<script setup lang="ts">
import draggable from 'vuedraggable';

interface RelationItem {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
  contentTypeName: string;
}

const props = defineProps<{
  label: string;
  items: RelationItem[];
}>();

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
  <div class="space-y-2">
    <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
      {{ label }}
    </span>
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
            class="flex items-center h-14 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 gap-2"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0 size-3.5"
            />
            <div
              class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0 cursor-pointer"
              @click="emit('edit', idx)"
            >
              <span
                class="text-xs font-semibold text-blue-700 dark:text-blue-300"
              >
                {{ item.contentTypeName.charAt(0).toUpperCase() }}
              </span>
            </div>
            <div
              class="flex-1 min-w-0 cursor-pointer"
              @click="emit('edit', idx)"
            >
              <p
                class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
              >
                {{ item.entryTitle || 'Untitled' }}
              </p>
              <p class="text-xs text-muted">{{ item.contentTypeName }}</p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              class="shrink-0 opacity-50 hover:opacity-100"
              @click.stop="emit('remove', idx)"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-muted shrink-0 cursor-pointer"
              @click="emit('edit', idx)"
            />
          </div>
        </template>
      </draggable>
      <div
        class="flex items-center justify-center h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 gap-2 cursor-pointer hover:border-gray-400 transition-colors"
        @click="emit('add')"
      >
        <UIcon name="i-lucide-plus" class="size-3.5 text-muted" />
        <span class="text-sm font-medium text-muted">Add entry</span>
      </div>
    </div>
  </div>
</template>
