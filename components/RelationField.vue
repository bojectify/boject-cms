<script setup lang="ts">
defineProps<{
  label: string;
  required?: boolean;
  value: { contentTypeId: string; entryId: string } | null;
  entryTitle: string | null;
  contentTypeName: string | null;
}>();

const emit = defineEmits<{
  add: [];
  edit: [];
  remove: [];
}>();
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-1">
      <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
        {{ label }}
      </span>
      <span v-if="required" class="text-sm text-red-500">*</span>
    </div>
    <div
      v-if="!value"
      class="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 gap-2 cursor-pointer hover:border-gray-400 transition-colors"
      @click="emit('add')"
    >
      <UIcon name="i-lucide-plus" class="size-4 text-muted" />
      <span class="text-sm font-medium text-muted">Add entry</span>
    </div>
    <div
      v-else
      class="flex items-center h-14 px-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
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
        <p
          class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
        >
          {{ entryTitle ?? 'Untitled' }}
        </p>
        <p class="text-xs text-muted">
          {{ contentTypeName ?? 'Unknown type' }}
        </p>
      </div>
      <UButton
        size="xs"
        variant="ghost"
        icon="i-lucide-x"
        class="shrink-0 opacity-50 hover:opacity-100"
        @click.stop="emit('remove')"
      />
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0" />
    </div>
  </div>
</template>
