<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

if (id === 'new') {
  await navigateTo('/images', { replace: true });
}

const fields: FieldConfig[] = [
  { type: 'text', key: 'url', label: 'URL', required: true },
  { type: 'text', key: 'alt', label: 'Alt Text', required: true },
  { type: 'number', key: 'width', label: 'Width', required: true },
  { type: 'number', key: 'height', label: 'Height', required: true },
  { type: 'number', key: 'focalPointX', label: 'Focal Point X (0-1)' },
  { type: 'number', key: 'focalPointY', label: 'Focal Point Y (0-1)' },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('images', id);

watch(
  () => formState.alt,
  (alt) => {
    if (typeof alt === 'string') {
      formState.entryTitle = alt;
      formState.slug = generateSlug(alt);
    }
  }
);
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Image"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  />
</template>
