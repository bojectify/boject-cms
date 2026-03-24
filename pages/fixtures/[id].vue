<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;
const isNew = id === 'new';

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
  { type: 'datetime', key: 'kickoff', label: 'Kickoff', required: true },
  { type: 'text', key: 'venue', label: 'Venue', required: true },
  { type: 'boolean', key: 'isHome', label: 'Home Match' },
  {
    type: 'relation',
    key: 'teamId',
    label: 'Team',
    optionsEndpoint: '/api/teams/options',
  },
  {
    type: 'relation',
    key: 'opponentId',
    label: 'Opponent',
    optionsEndpoint: '/api/clubs/options',
  },
  {
    type: 'relation',
    key: 'competitionId',
    label: 'Competition',
    optionsEndpoint: '/api/competitions/options',
  },
  {
    type: 'relation',
    key: 'seasonId',
    label: 'Season',
    optionsEndpoint: '/api/seasons/options',
  },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('fixtures', id);

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
    await navigateTo(`/fixtures/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="isNew ? 'New Fixture' : 'Edit Fixture'"
    :fields="fields"
    :loading="!isNew && loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="handleSave"
  />
</template>
