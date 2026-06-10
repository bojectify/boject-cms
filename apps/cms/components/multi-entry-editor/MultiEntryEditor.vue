<script setup lang="ts">
import type { MultiEntryEditorProps } from './multiEntryEditor.types';
import type { EntryOption } from '~/components/query-builder/queryBuilder.types';
import { QA_MULTI_ENTRY_EDITOR } from './multiEntryEditor.config';
import { useMultiSelect } from '~/composables/useMultiSelect';

const props = withDefaults(defineProps<MultiEntryEditorProps>(), {
  testId: QA_MULTI_ENTRY_EDITOR.COMPONENT,
});
const emit = defineEmits<{
  toggle: [value: string];
  captureLabel: [payload: { id: string; title: string }];
}>();

const draftRef = computed(() => props.draft);
const { isSelected } = useMultiSelect(draftRef);
const entries = ref<EntryOption[]>([]);
const isActive = (id: string) => props.activeId === id;

// Mirror the single-entry editor: load on mount + on text/draft change so the
// list shows the moment the value step opens, and narrows as the user types.
watch(
  [() => props.draft, () => props.text],
  async () => {
    if (props.searchEntries) {
      entries.value = await props.searchEntries(
        props.draft.field.targetContentTypeIds ?? [],
        props.text
      );
    }
  },
  { immediate: true }
);

function onPick(e: EntryOption) {
  // Capture the title (for the committed chip's id→title map) then toggle.
  emit('captureLabel', { id: e.id, title: e.entryTitle });
  emit('toggle', e.id);
}
</script>

<template>
  <div :data-testid="testId" class="flex flex-col gap-0.5">
    <button
      v-for="(e, i) in entries"
      :id="`qb-opt-mentry-${i}`"
      :key="e.id"
      type="button"
      role="option"
      :aria-selected="isSelected(e.id)"
      class="flex items-center gap-2.5 h-12 px-3 rounded-lg hover:bg-elevated text-left"
      :class="{ 'bg-elevated': isActive(`qb-opt-mentry-${i}`) }"
      :data-testid="QA_MULTI_ENTRY_EDITOR.OPTION(i)"
      @click="onPick(e)"
    >
      <span
        class="flex items-center justify-center size-4 rounded border border-default shrink-0"
        :class="isSelected(e.id) ? 'bg-primary border-primary' : ''"
      >
        <UIcon
          v-if="isSelected(e.id)"
          name="i-lucide-check"
          class="size-3 text-inverted"
        />
      </span>
      <span class="text-[13px] font-medium text-highlighted">{{
        e.entryTitle
      }}</span>
      <span class="ml-auto text-[11px] text-dimmed">{{
        e.contentTypeName
      }}</span>
    </button>
  </div>
</template>
