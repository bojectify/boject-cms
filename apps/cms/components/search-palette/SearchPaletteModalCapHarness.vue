<script setup lang="ts">
// Story-only harness (#364): mounts the ⌘K palette's QueryBuilder inside the
// REAL Nuxt UI UModal with the SAME `:ui.content` override the app uses, so the
// live modal theme participates in the twMerge. SearchPalette.vue itself can't be
// story-mounted cheaply (it fetches `/api/content-types/with-fields` + drives the
// useSearchPalette composable), so this thin shell reproduces just the modal +
// builder composition the cap regression needs. Not a product component.
import type { QueryContentType } from '~/utils/queryBuilder/types';
import type { EntryOption } from '~/components/query-builder/queryBuilder.types';
import { SEARCH_PALETTE_MODAL_CONTENT_UI } from './searchPalette.config';

defineProps<{
  contentTypes: QueryContentType[];
  searchEntries: (ids: string[], q: string) => Promise<EntryOption[]>;
}>();
</script>

<template>
  <UModal
    :open="true"
    :overlay="true"
    :close="false"
    :ui="{ content: SEARCH_PALETTE_MODAL_CONTENT_UI }"
  >
    <template #content>
      <QueryBuilder
        :content-types="contentTypes"
        :search-entries="searchEntries"
      />
    </template>
  </UModal>
</template>
