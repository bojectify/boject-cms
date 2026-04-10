<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'label', label: 'Label', required: true },
  {
    type: 'text',
    key: 'url',
    label: 'URL',
    placeholder: '/page or https://...',
  },
  {
    type: 'relation',
    key: 'articleId',
    label: 'Article',
    optionsEndpoint: '/api/articles/options',
  },
  { type: 'boolean', key: 'openInNewTab', label: 'Open in new tab' },
];

const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEditor('links', id);

watch(
  () => formState.label,
  (label) => {
    if (typeof label === 'string') {
      formState.entryTitle = label;
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/links/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="formState.label ? String(formState.label) : 'New Link'"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :show-slug="false"
    :on-save="handleSave"
  />
</template>
