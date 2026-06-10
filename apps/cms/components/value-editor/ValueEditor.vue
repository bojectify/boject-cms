<script setup lang="ts">
import { valueInputKind, operatorLabel } from '~/utils/queryBuilder/operators';
import type { ValueEditorProps } from './valueEditor.types';
import type { EntryOption } from '../query-builder/queryBuilder.types';
import { QA_VALUE_EDITOR } from './valueEditor.config';

const props = withDefaults(defineProps<ValueEditorProps>(), {
  testId: QA_VALUE_EDITOR.COMPONENT,
});
const emit = defineEmits<{
  setValue: [value: unknown];
  commit: [];
  chooseEntry: [entry: EntryOption];
}>();

const kind = computed(() =>
  valueInputKind(props.draft.field.type, props.draft.op)
);
const opLabel = computed(() =>
  operatorLabel(props.draft.field.type, props.draft.op)
);
function confirmTyped() {
  emit('setValue', props.text);
  emit('commit');
}
const entries = ref<EntryOption[]>([]);
// Fire on mount (immediate) AND on every draft/text change, so a relation field
// shows its entries the moment its value step opens — not only after the user
// types. Watching `draft` too covers switching directly between relation fields.
watch(
  [() => props.draft, () => props.text],
  async () => {
    if (kind.value === 'entry' && props.searchEntries) {
      entries.value = await props.searchEntries(
        props.draft.field.targetContentTypeIds ?? [],
        props.text
      );
    }
  },
  { immediate: true }
);
function choose(v: unknown) {
  emit('setValue', v);
  emit('commit');
}

/** Whether an option id is the keyboard-highlighted one. */
const isActive = (id: string) => props.activeId === id;
</script>

<template>
  <div :data-testid="testId" class="flex flex-col gap-0.5">
    <template v-if="kind === 'boolean'">
      <button
        v-for="(opt, i) in [
          ['True', true],
          ['False', false],
        ]"
        :id="`qb-opt-bool-${i}`"
        :key="String(opt[1])"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-bool-${i}`)"
        class="flex items-center gap-2.5 h-10 px-3 rounded-lg hover:bg-elevated text-left"
        :class="{ 'bg-elevated': isActive(`qb-opt-bool-${i}`) }"
        :data-testid="QA_VALUE_EDITOR.OPTION(i)"
        @click="choose(opt[1])"
      >
        <span
          class="size-2 rounded-full"
          :class="opt[1] ? 'bg-success' : 'bg-muted'"
        />
        <span class="text-[13px] text-highlighted">{{ opt[0] }}</span>
      </button>
    </template>

    <template v-else-if="kind === 'select'">
      <button
        v-for="(c, i) in draft.field.choices ?? []"
        :id="`qb-opt-select-${i}`"
        :key="c.value"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-select-${i}`)"
        class="flex items-center gap-2.5 h-10 px-3 rounded-lg hover:bg-elevated text-left"
        :class="{ 'bg-elevated': isActive(`qb-opt-select-${i}`) }"
        :data-testid="QA_VALUE_EDITOR.OPTION(i)"
        @click="choose(c.value)"
      >
        <span class="text-[13px] text-highlighted">{{ c.label }}</span>
      </button>
    </template>

    <template v-else-if="kind === 'entry'">
      <button
        v-for="(e, i) in entries"
        :id="`qb-opt-entry-${i}`"
        :key="e.id"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-entry-${i}`)"
        class="flex items-center gap-2.5 h-12 px-3 rounded-lg hover:bg-elevated text-left"
        :class="{ 'bg-elevated': isActive(`qb-opt-entry-${i}`) }"
        :data-testid="QA_VALUE_EDITOR.OPTION(i)"
        @click="emit('chooseEntry', e)"
      >
        <span class="text-[13px] font-medium text-highlighted">{{
          e.entryTitle
        }}</span>
        <span class="ml-auto text-[11px] text-dimmed">{{
          e.contentTypeName
        }}</span>
      </button>
    </template>

    <template v-else>
      <!-- text / number: free entry typed into the chip's value
           segment. A confirm row appears once something is typed; clicking it
           (or → / Enter from the value segment) commits the filter. -->
      <button
        v-if="text"
        id="qb-opt-confirm"
        type="button"
        role="option"
        :aria-selected="isActive('qb-opt-confirm')"
        class="flex items-center gap-2.5 h-11 px-3 rounded-lg hover:bg-elevated text-left"
        :class="{ 'bg-elevated': isActive('qb-opt-confirm') }"
        :data-testid="QA_VALUE_EDITOR.CONFIRM"
        @click="confirmTyped"
      >
        <span
          class="flex items-center justify-center size-7 rounded-md bg-primary text-inverted shrink-0"
        >
          <UIcon name="i-lucide-plus" class="size-3.5" />
        </span>
        <span class="text-muted text-sm">
          Add filter — {{ draft.field.name }} {{ opLabel }}
          <span class="font-semibold text-highlighted">“{{ text }}”</span>
        </span>
        <UKbd value="→" class="ml-auto shrink-0" />
      </button>
      <div
        v-else
        class="px-3 py-2 text-xs text-dimmed"
        :data-testid="QA_VALUE_EDITOR.HINT"
      >
        Type a value, then <UKbd value="→" /> to add the filter, or
        <UKbd value="↵" /> to search.
      </div>
    </template>
  </div>
</template>
