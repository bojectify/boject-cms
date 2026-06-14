<script setup lang="ts">
import { isColumnableFieldType } from '~/utils/searchColumns';
import { FIELD_TYPE_LABELS } from '~/utils/fieldTypes';
import type { SearchColumnPickerProps } from './searchColumnPicker.types';
import { QA_SEARCH_COLUMN_PICKER } from './searchColumnPicker.config';

const props = withDefaults(defineProps<SearchColumnPickerProps>(), {
  testId: QA_SEARCH_COLUMN_PICKER.COMPONENT,
});
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

// Defensive: only ever offer columnable fields, in content-type order.
const columnableFields = computed(() =>
  props.fields.filter((f) => isColumnableFieldType(f.type))
);

function isActive(id: string): boolean {
  return props.modelValue.includes(id);
}

function toggle(id: string): void {
  emit(
    'update:modelValue',
    isActive(id)
      ? props.modelValue.filter((c) => c !== id)
      : [...props.modelValue, id]
  );
}
</script>

<template>
  <UPopover :content="{ align: 'end' }">
    <UButton
      :data-testid="QA_SEARCH_COLUMN_PICKER.TRIGGER"
      icon="i-lucide-columns-3"
      color="neutral"
      variant="outline"
      trailing-icon="i-lucide-chevron-down"
    >
      Columns
    </UButton>

    <template #content>
      <div
        :data-testid="QA_SEARCH_COLUMN_PICKER.PANEL"
        role="listbox"
        aria-label="Show columns"
        class="w-64 p-2"
      >
        <p
          class="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Show columns · {{ contentTypeIdentifier }}
        </p>
        <button
          v-for="field in columnableFields"
          :key="field.identifier"
          :data-testid="QA_SEARCH_COLUMN_PICKER.ROW.id(field.identifier)"
          type="button"
          role="option"
          :aria-selected="isActive(field.identifier)"
          class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-elevated"
          @click="toggle(field.identifier)"
        >
          <UCheckbox
            :model-value="isActive(field.identifier)"
            tabindex="-1"
            aria-hidden="true"
          />
          <span class="flex-1 text-sm text-highlighted">{{ field.name }}</span>
          <span class="text-xs text-muted">{{
            FIELD_TYPE_LABELS[field.type]
          }}</span>
        </button>
      </div>
    </template>
  </UPopover>
</template>
