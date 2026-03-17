<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'title', label: 'Title', required: true },
  { type: 'textarea', key: 'summary', label: 'Summary', rows: 3 },
  {
    type: 'relation',
    key: 'authorId',
    label: 'Author',
    optionsEndpoint: '/api/authors/options',
  },
  {
    type: 'relation',
    key: 'featuredImageId',
    label: 'Featured Image',
    optionsEndpoint: '/api/images/options',
  },
  {
    type: 'multirelation',
    key: 'tagIds',
    label: 'Tags',
    optionsEndpoint: '/api/tags/options',
  },
  { type: 'richtext', key: 'body', label: 'Body' },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('articles', id);

watch(
  () => formState.title,
  (title) => {
    if (typeof title === 'string') {
      formState.entryTitle = title;
      formState.slug = generateSlug(title);
    }
  }
);

// Map tags array from API response to tagIds array for the multirelation field
watch(
  () => formState.tags,
  (tags) => {
    if (Array.isArray(tags)) {
      formState.tagIds = (tags as Array<{ id: string }>).map((t) => t.id);
    }
  },
  { immediate: true }
);
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Article"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  />
</template>
