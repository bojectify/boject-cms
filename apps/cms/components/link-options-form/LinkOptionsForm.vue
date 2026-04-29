<script setup lang="ts">
import type {
  LinkOptions,
  LinkOptionsFormProps,
} from './linkOptionsForm.types';
import { QA_LINK_OPTIONS_FORM } from './linkOptionsForm.config';

const props = withDefaults(defineProps<LinkOptionsFormProps>(), {
  testId: QA_LINK_OPTIONS_FORM.COMPONENT,
  labelPlaceholder: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: LinkOptions];
}>();

const label = computed({
  get: () => props.modelValue.label,
  set: (val: string) =>
    emit('update:modelValue', { ...props.modelValue, label: val }),
});

const newTab = computed({
  get: () => props.modelValue.target === '_blank',
  set: (val: boolean) =>
    emit('update:modelValue', {
      ...props.modelValue,
      target: val ? '_blank' : null,
    }),
});

const nofollow = computed({
  get: () => props.modelValue.rel === 'nofollow',
  set: (val: boolean) =>
    emit('update:modelValue', {
      ...props.modelValue,
      rel: val ? 'nofollow' : null,
    }),
});
</script>

<template>
  <div :data-testid="testId" class="space-y-3">
    <UFormField label="Display text">
      <UInput
        v-model="label"
        :placeholder="labelPlaceholder"
        class="w-full"
        :data-testid="QA_LINK_OPTIONS_FORM.LABEL_INPUT"
      />
    </UFormField>
    <USwitch
      v-model="newTab"
      label="Open in new tab"
      :data-testid="QA_LINK_OPTIONS_FORM.TARGET_TOGGLE"
    />
    <USwitch
      v-model="nofollow"
      label="Add nofollow"
      :data-testid="QA_LINK_OPTIONS_FORM.NOFOLLOW_TOGGLE"
    />
  </div>
</template>
