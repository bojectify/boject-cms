<script setup lang="ts">
import type {
  SearchResultsProps,
  SearchResultsEmits,
} from './searchResults.types';
import { QA_SEARCH_RESULTS } from './searchResults.config';
import { highlightToSafeHtml } from '~/utils/searchSnippet';
import { useContentTable } from '~/composables/useContentTable';

withDefaults(defineProps<SearchResultsProps>(), {
  testId: QA_SEARCH_RESULTS.COMPONENT,
});
const emit = defineEmits<SearchResultsEmits>();

const { formatDate } = useContentTable();
</script>

<template>
  <div :data-testid="testId" class="flex flex-col gap-4">
    <!-- Chip-summary bar: read-only active query -->
    <div
      :data-testid="QA_SEARCH_RESULTS.SUMMARY_BAR"
      class="flex items-center gap-2 flex-wrap"
    >
      <ContentTypeChip
        v-if="contentTypeName"
        :name="contentTypeName"
        @remove="emit('clear')"
      />
      <FilterChip
        v-for="(f, i) in query.filters"
        :key="i"
        :field="f.field"
        :operator="f.op"
        :value="f.value == null ? null : String(f.value)"
        @remove="emit('removeFilter', i)"
      />
      <span v-if="query.q" class="text-sm text-muted"
        >&ldquo;{{ query.q }}&rdquo;</span
      >
      <div class="ml-auto flex items-center gap-2">
        <UButton
          :data-testid="QA_SEARCH_RESULTS.EDIT"
          size="sm"
          variant="ghost"
          icon="i-lucide-pencil"
          @click="emit('edit')"
        >
          Edit <UKbd value="meta" /><UKbd value="k" />
        </UButton>
        <UButton
          :data-testid="QA_SEARCH_RESULTS.CLEAR"
          size="sm"
          variant="outline"
          @click="emit('clear')"
        >
          Clear search
        </UButton>
      </div>
    </div>

    <!-- Unavailable (503) -->
    <div
      v-if="unavailable"
      :data-testid="QA_SEARCH_RESULTS.UNAVAILABLE"
      class="flex flex-col items-center gap-2 py-16 text-center"
    >
      <UIcon name="i-lucide-search-x" class="size-8 text-dimmed" />
      <p class="text-highlighted font-medium">
        Search is temporarily unavailable
      </p>
      <p class="text-sm text-muted">
        The search service is down. Clear search to keep browsing.
      </p>
    </div>

    <!-- Loading -->
    <div
      v-else-if="loading"
      :data-testid="QA_SEARCH_RESULTS.LOADING"
      class="flex flex-col gap-2 py-4"
    >
      <USkeleton v-for="n in 5" :key="n" class="h-12 w-full" />
    </div>

    <!-- No results -->
    <div
      v-else-if="!hits.length"
      :data-testid="QA_SEARCH_RESULTS.EMPTY"
      class="flex flex-col items-center gap-2 py-16 text-center"
    >
      <UIcon name="i-lucide-search" class="size-8 text-dimmed" />
      <p class="text-highlighted font-medium">No matching entries</p>
      <p class="text-sm text-muted">
        Try removing a filter or broadening your search.
      </p>
    </div>

    <!-- Results -->
    <div v-else :data-testid="QA_SEARCH_RESULTS.TABLE" class="flex flex-col">
      <NuxtLink
        v-for="(hit, i) in hits"
        :key="hit.id"
        :data-testid="QA_SEARCH_RESULTS.ROW(i)"
        :to="`/entries/${hit.id}`"
        class="flex flex-col gap-1 px-4 py-3 border-b border-default hover:bg-elevated"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="text-highlighted font-medium truncate">{{
            hit.entryTitle
          }}</span>
          <span class="text-xs text-muted shrink-0">{{
            hit.publishedAt ? formatDate(hit.publishedAt) : '—'
          }}</span>
        </div>
        <!-- eslint-disable vue/no-v-html -- snippet HTML is sanitised by highlightToSafeHtml -->
        <p
          v-if="hit.snippet"
          class="text-sm text-muted search-snippet"
          v-html="highlightToSafeHtml(hit.snippet)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </NuxtLink>

      <div class="flex justify-center pt-4">
        <UPagination
          :page="page"
          :total="total"
          :items-per-page="15"
          @update:page="emit('update:page', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference '~/assets/css/main.css';

/*
  Snippet highlight: <em> tokens come from Meili's match cropping (see
  highlightToSafeHtml). The repo's amber accent is the semantic `warning`
  colour (Nuxt UI maps it to amber; see app-wide `bg-warning/*` usage). Render
  the highlight upright (non-italic) with a soft amber wash via @apply on the
  warning utilities — token-based, no raw hex. The @reference above pulls the
  theme so the semantic utilities resolve inside this scoped block (mirrors
  RichTextEditor).
*/
.search-snippet :deep(em) {
  @apply not-italic bg-warning/15 text-warning rounded-xs px-px;
}
</style>
