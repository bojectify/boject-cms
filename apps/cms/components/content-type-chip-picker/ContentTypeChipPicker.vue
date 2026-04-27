<script setup lang="ts">
import type { ContentTypeChipPickerProps } from './contentTypeChipPicker.types';
import { QA_CONTENT_TYPE_CHIP_PICKER } from './contentTypeChipPicker.config';

const props = withDefaults(defineProps<ContentTypeChipPickerProps>(), {
  testId: QA_CONTENT_TYPE_CHIP_PICKER.COMPONENT,
  addPlaceholder: 'Add content type...',
  emptyHint: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const availableOptions = computed(() =>
  (props.options ?? []).filter((o) => !props.modelValue.includes(o.value))
);

const labelFor = (value: string) =>
  (props.options ?? []).find((o) => o.value === value)?.label ?? value;

function removeChip(value: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== value)
  );
}

function addChip(value: string) {
  if (!value) return;
  if (props.modelValue.includes(value)) return;
  emit('update:modelValue', [...props.modelValue, value]);
}
</script>

<template>
  <div :data-testid="testId" class="space-y-2">
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-2">
      <UBadge
        v-for="value in modelValue"
        :key="value"
        size="md"
        variant="subtle"
        color="info"
        class="cursor-pointer"
        :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.CHIP"
        @click="removeChip(value)"
      >
        {{ labelFor(value) }}
        <UIcon name="i-lucide-x" class="size-3 ml-1" />
      </UBadge>
    </div>
    <p
      v-else-if="emptyHint"
      class="text-xs text-muted"
      :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.EMPTY"
    >
      {{ emptyHint }}
    </p>
    <USelect
      :model-value="''"
      :items="availableOptions"
      value-key="value"
      :placeholder="addPlaceholder"
      class="w-full"
      :data-testid="QA_CONTENT_TYPE_CHIP_PICKER.ADD_SELECT"
      @update:model-value="(val: string) => addChip(val)"
    />
  </div>
</template>
