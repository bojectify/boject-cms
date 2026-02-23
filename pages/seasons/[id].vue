<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
  { type: 'datetime', key: 'startDate', label: 'Start Date', required: true },
  { type: 'datetime', key: 'endDate', label: 'End Date', required: true },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('seasons', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Season"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  />
</template>
