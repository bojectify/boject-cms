<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;
const isNew = id === 'new';

const fields: FieldConfig[] = [
  { type: 'text', key: 'firstName', label: 'First Name', required: true },
  { type: 'text', key: 'lastName', label: 'Last Name', required: true },
  {
    type: 'relation',
    key: 'positionId',
    label: 'Position',
    optionsEndpoint: '/api/positions/options',
  },
  { type: 'textarea', key: 'bio', label: 'Bio', rows: 6 },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('players', id);

watch(
  [() => formState.firstName, () => formState.lastName],
  ([first, last]) => {
    if (typeof first === 'string' && typeof last === 'string') {
      const fullName = `${first} ${last}`.trim();
      formState.entryTitle = fullName;
      formState.slug = generateSlug(fullName);
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/players/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="isNew ? 'New Player' : 'Edit Player'"
    :fields="fields"
    :loading="!isNew && loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="handleSave"
  />
</template>
