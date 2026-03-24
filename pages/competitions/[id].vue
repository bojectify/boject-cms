<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;
const isNew = id === 'new';

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
  {
    type: 'relation',
    key: 'seasonId',
    label: 'Season',
    optionsEndpoint: '/api/seasons/options',
  },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('competitions', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/competitions/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="isNew ? 'New Competition' : 'Edit Competition'"
    :fields="fields"
    :loading="!isNew && loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="handleSave"
  />
</template>
