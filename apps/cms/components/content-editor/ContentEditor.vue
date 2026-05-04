<script setup lang="ts">
import type { FormError } from '@nuxt/ui';
import type { FieldConfig } from '~/types/contentEditor';
import type { ImageFieldValue } from '../image-field/imageField.types';
import type { ContentEditorProps } from './contentEditor.types';
import { QA_CONTENT_EDITOR } from './contentEditor.config';

const props = withDefaults(defineProps<ContentEditorProps>(), {
  testId: QA_CONTENT_EDITOR.COMPONENT,
});

const state = defineModel<Record<string, unknown>>('state', {
  required: true,
});

const form = useTemplateRef('form');

const relationOptions = reactive<
  Record<string, { label: string; value: string }[]>
>({});

onMounted(async () => {
  const relationFields = props.fields.filter(
    (f): f is Extract<FieldConfig, { type: 'relation' }> =>
      f.type === 'relation'
  );
  const multirelationFields = props.fields.filter(
    (f): f is Extract<FieldConfig, { type: 'multirelation' }> =>
      f.type === 'multirelation'
  );
  await Promise.all([
    ...relationFields.map(async (field) => {
      const data = await $fetch<{ label: string; value: string }[]>(
        field.optionsEndpoint
      );
      relationOptions[field.key] = data;
    }),
    ...multirelationFields.map(async (field) => {
      const data = await $fetch<{ label: string; value: string }[]>(
        field.optionsEndpoint
      );
      relationOptions[field.key] = data;
    }),
  ]);
});

function toDatetimeLocal(iso: unknown): string {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(val: string): string {
  if (!val) return '';
  return new Date(val).toISOString();
}

function validate(formData: Record<string, unknown>): FormError[] {
  const errors: FormError[] = [];
  const knownKeys = new Set(props.fields.map((f) => f.key));
  for (const field of props.fields) {
    if ('required' in field && field.required) {
      const val = formData[field.key];
      if (val === undefined || val === null || val === '') {
        errors.push({
          name: field.key,
          message: `${field.label} is required`,
        });
      }
    }
  }
  for (const [key, message] of Object.entries(props.fieldErrors ?? {})) {
    if (knownKeys.has(key)) {
      errors.push({ name: key, message });
    }
  }
  return errors;
}

async function runValidation(): Promise<boolean> {
  const f = form.value;
  if (!f) return true;
  try {
    await f.validate({});
    return true;
  } catch {
    return false;
  }
}

defineExpose({ validate: runValidation });
</script>

<template>
  <div class="p-6 sm:p-8" :data-testid="testId">
    <h1 class="text-2xl font-bold mb-6">{{ title }}</h1>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
      class="mb-6"
    />

    <div v-if="loading" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="animate-spin size-8 text-muted" />
    </div>

    <UForm
      v-else
      ref="form"
      :validate="validate"
      :state="state"
      class="space-y-6 max-w-2xl"
    >
      <template v-for="field in fields" :key="field.key">
        <slot
          name="field"
          :field="field"
          :value="state[field.key]"
          :update="(val: unknown) => (state[field.key] = val)"
        >
          <UFormField
            v-if="field.type === 'text'"
            :label="field.readonly ? `${field.label} (read-only)` : field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <UInput
              :model-value="(state[field.key] as string) ?? ''"
              :placeholder="field.placeholder"
              :readonly="field.readonly"
              class="w-full"
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'textarea'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <UTextarea
              :model-value="(state[field.key] as string) ?? ''"
              :placeholder="field.placeholder"
              :rows="field.rows ?? 4"
              class="w-full"
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'number'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <UInput
              type="number"
              :model-value="
                state[field.key] != null ? String(state[field.key]) : ''
              "
              :placeholder="field.placeholder"
              class="w-full"
              @update:model-value="
                state[field.key] = $event === '' ? null : Number($event)
              "
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'boolean'"
            :name="field.key"
            size="xl"
          >
            <USwitch
              :model-value="(state[field.key] as boolean) ?? false"
              :label="field.label"
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'datetime'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <UInput
              type="datetime-local"
              :model-value="toDatetimeLocal(state[field.key])"
              class="w-full"
              @update:model-value="
                state[field.key] = fromDatetimeLocal($event as string)
              "
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'select'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <USelect
              :model-value="(state[field.key] as string) ?? ''"
              :items="field.options"
              value-key="value"
              class="w-full"
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'relation'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <USelect
              :model-value="(state[field.key] as string) ?? ''"
              :items="relationOptions[field.key] ?? []"
              value-key="value"
              placeholder="Select..."
              class="w-full"
              @update:model-value="state[field.key] = $event || null"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'multirelation'"
            :label="field.label"
            :name="field.key"
            size="xl"
          >
            <USelectMenu
              :model-value="(state[field.key] as string[]) ?? []"
              :items="relationOptions[field.key] ?? []"
              value-key="value"
              multiple
              placeholder="Select..."
              class="w-full"
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'richtext'"
            :label="field.label"
            :name="field.key"
            size="xl"
          >
            <RichTextEditor
              :model-value="state[field.key]"
              :target-content-type-ids="field.targetContentTypeIds ?? []"
              :link-target-content-type-ids="
                field.linkTargetContentTypeIds ?? []
              "
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <UFormField
            v-else-if="field.type === 'image'"
            :label="field.label"
            :name="field.key"
            :required="field.required"
            size="xl"
          >
            <ImageField
              :field="field"
              :model-value="
                (state[field.key] as ImageFieldValue | null) ?? null
              "
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>
        </slot>
      </template>

      <slot name="after-fields" />
    </UForm>
  </div>
</template>
