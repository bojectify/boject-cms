<script setup lang="ts">
import type { FormError } from '@nuxt/ui';
import type { FieldConfig } from '~/types/contentEditor';
import type { ImageFieldValue } from '../image-field/imageField.types';
import type { ContentEditorProps } from './contentEditor.types';
import { QA_CONTENT_EDITOR } from './contentEditor.config';

const props = withDefaults(defineProps<ContentEditorProps>(), {
  testId: QA_CONTENT_EDITOR.COMPONENT,
  status: 'DRAFT',
  hasPublishedVersion: false,
  isDirty: false,
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
  if (
    props.showSlug !== false &&
    (!formData.slug ||
      (typeof formData.slug === 'string' && !formData.slug.trim()))
  ) {
    errors.push({ name: 'slug', message: 'Slug is required' });
  }
  return errors;
}

function onSubmit() {
  props.onSaveDraft();
}

// --- Button state computeds ---

const isPublished = computed(
  () => props.status === 'PUBLISHED' && !props.isDirty
);
const isPublishedDirty = computed(
  () => props.status === 'PUBLISHED' && props.isDirty
);
const isChanged = computed(() => props.status === 'CHANGED');

const primaryLabel = computed(() => {
  if (isChanged.value) return 'Publish Changes';
  if (isPublished.value) return 'Published';
  return 'Publish';
});
const primaryDisabled = computed(
  () => isPublished.value || isPublishedDirty.value
);

const secondaryLabel = computed(() => {
  if (isChanged.value) return 'Save Changes';
  return 'Save Draft';
});
const secondaryVisible = computed(() => !isPublished.value);

// --- Status badge ---

const statusBadgeColor = computed(() => {
  switch (props.status) {
    case 'DRAFT':
      return 'info' as const;
    case 'PUBLISHED':
      return 'success' as const;
    case 'CHANGED':
      return 'warning' as const;
    case 'ARCHIVED':
      return 'neutral' as const;
    default:
      return 'neutral' as const;
  }
});

const statusBadgeLabel = computed(() => {
  switch (props.status) {
    case 'DRAFT':
      return 'Draft';
    case 'PUBLISHED':
      return 'Published';
    case 'CHANGED':
      return 'Changed';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return props.status ?? 'Draft';
  }
});
</script>

<template>
  <div class="p-6 sm:p-8" :data-testid="testId">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">{{ title }}</h1>
      <div class="flex items-center gap-2">
        <UButton
          v-if="isChanged && onDiscardChanges"
          variant="ghost"
          color="error"
          @click="onDiscardChanges"
        >
          Discard Changes
        </UButton>
        <UButton
          v-if="secondaryVisible"
          variant="soft"
          :loading="saving"
          @click="form?.submit()"
        >
          {{ secondaryLabel }}
        </UButton>
        <UButton
          :loading="saving && !secondaryVisible"
          :disabled="primaryDisabled"
          icon="i-lucide-send"
          @click="onPublish"
        >
          {{ primaryLabel }}
        </UButton>
      </div>
    </div>

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
      @submit="onSubmit"
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
              @update:model-value="state[field.key] = $event"
            />
          </UFormField>

          <template v-else-if="field.type === 'image'">
            <ImageField
              :field="field"
              :model-value="
                (state[field.key] as ImageFieldValue | null) ?? null
              "
              @update:model-value="state[field.key] = $event"
            />
          </template>
        </slot>
      </template>

      <slot name="after-fields" />

      <USeparator label="Publishing" />

      <UFormField label="Status" name="status" size="xl">
        <UBadge :color="statusBadgeColor" size="lg">
          {{ statusBadgeLabel }}
        </UBadge>
      </UFormField>

      <UFormField
        v-if="props.showSlug !== false"
        label="Slug"
        name="slug"
        required
        size="xl"
      >
        <UInput
          :model-value="(state.slug as string) ?? ''"
          class="w-full"
          @update:model-value="state.slug = $event"
        />
      </UFormField>
    </UForm>
  </div>
</template>
