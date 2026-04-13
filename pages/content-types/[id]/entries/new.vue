<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const contentTypeId = route.params.id as string;

// Fetch content type to get field definitions
const { data: contentType } = await useFetch<{
  id: string;
  name: string;
  fields: Array<{
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
  }>;
}>(`/api/content-types/${contentTypeId}`);

const hasSlugField = computed(
  () => contentType.value?.fields.some((f) => f.type === 'SLUG') ?? false
);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.identifier ?? 'title';
});

// Map ContentTypeField definitions to FieldConfig for ContentEditor
// Filter out SLUG fields (handled by ContentEditor's built-in slug section)
const editorFields = computed<FieldConfig[]>(() => {
  if (!contentType.value) return [];
  return contentType.value.fields
    .filter((f) => f.type !== 'SLUG')
    .map((f) => mapFieldToConfig(f));
});

function mapFieldToConfig(field: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}): FieldConfig {
  switch (field.type) {
    case 'ENTRY_TITLE':
    case 'TEXT':
      return {
        type: 'text',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'TEXTAREA':
      return {
        type: 'textarea',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'NUMBER':
      return {
        type: 'number',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'BOOLEAN':
      return {
        type: 'boolean',
        key: field.identifier,
        label: field.name,
      };
    case 'DATETIME':
      return {
        type: 'datetime',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'SELECT': {
      const opts = field.options as { choices?: string[] } | null;
      const choices = opts?.choices ?? [];
      return {
        type: 'select',
        key: field.identifier,
        label: field.name,
        required: field.required,
        options: choices.map((c) => ({ label: c, value: c })),
      };
    }
    case 'RICHTEXT':
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
      };
    default:
      return {
        type: 'text',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
  }
}

const { formState, isSaving, saveError, save, generateSlug } =
  useContentEntryEditor(contentTypeId, 'new');

// Auto-generate slug from ENTRY_TITLE field
watch(
  () => formState[entryTitleFieldIdentifier.value],
  (val) => {
    if (typeof val === 'string' && hasSlugField.value) {
      formState.slug = generateSlug(val);
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/content-types/${contentTypeId}/entries/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="`New ${contentType?.name ?? 'Entry'}`"
    :fields="editorFields"
    :loading="false"
    :saving="isSaving"
    :error="saveError"
    :show-slug="hasSlugField"
    :on-save="handleSave"
  />
</template>
