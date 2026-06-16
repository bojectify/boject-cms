<script setup lang="ts">
import type { BooleanTriStateProps } from './booleanTriState.types';
import { QA_BOOLEAN_TRI_STATE } from './booleanTriState.config';

const props = withDefaults(defineProps<BooleanTriStateProps>(), {
  testId: QA_BOOLEAN_TRI_STATE.COMPONENT,
  modelValue: undefined,
  disableNone: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean | undefined];
}>();

const options: {
  label: string;
  value: boolean | undefined;
  testId: string;
}[] = [
  { label: 'None', value: undefined, testId: QA_BOOLEAN_TRI_STATE.NONE },
  { label: 'True', value: true, testId: QA_BOOLEAN_TRI_STATE.TRUE },
  { label: 'False', value: false, testId: QA_BOOLEAN_TRI_STATE.FALSE },
];

// A disabled "None" segment never reads as the active selection — leaving it
// unhighlighted signals "pick True or False" for a required field.
function isActive(value: boolean | undefined): boolean {
  if (value === undefined && props.disableNone) return false;
  return props.modelValue === value;
}
</script>

<template>
  <UFieldGroup :data-testid="testId">
    <UButton
      v-for="opt in options"
      :key="opt.label"
      :data-testid="opt.testId"
      :disabled="opt.value === undefined && disableNone"
      :color="isActive(opt.value) ? 'primary' : 'neutral'"
      :variant="isActive(opt.value) ? 'solid' : 'outline'"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </UButton>
  </UFieldGroup>
</template>
