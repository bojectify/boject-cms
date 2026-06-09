<script setup lang="ts">
import { useQueryBuilder } from '~/composables/useQueryBuilder';
import type { QueryBuilderProps, EntryOption } from './queryBuilder.types';
import { QA_QUERY_BUILDER } from './queryBuilder.config';
import type { SearchFilter } from '~/utils/queryBuilder/types';
import { operatorLabel, valueInputKind } from '~/utils/queryBuilder/operators';

// QueryDropdown / ContentTypeChip / FilterChip / ValueEditor are auto-registered
// (Nuxt + Storybook scan components/), so they need no explicit import.

const props = withDefaults(defineProps<QueryBuilderProps>(), {
  enableRichOperators: false,
  testId: QA_QUERY_BUILDER.COMPONENT,
});
const emit = defineEmits(['update:modelValue', 'run', 'broaden']);

const { state, dispatch } = useQueryBuilder({
  contentTypes: props.contentTypes,
  lockedContentType: props.lockedContentType,
  rich: props.enableRichOperators,
  initialQuery: props.modelValue,
});

/**
 * entryId -> display title, captured when a relation value is chosen, so the
 * chip can show the title while the filter value stays the id (the engine
 * filters relations by entry id).
 */
const relationLabels = ref<Record<string, string>>({});

const mainInput = ref<HTMLInputElement>();
const valueInput = ref<HTMLInputElement>();

// Focus follows the step: the draft chip's value-segment input while a filter's
// value is being entered, the main input otherwise. This is what lands the
// cursor on the value segment the instant a field is picked.
watch(
  () => state.value.step,
  async (step) => {
    await nextTick();
    if (step === 'value') valueInput.value?.focus();
    else mainInput.value?.focus();
  },
  // immediate so the input is focused when the palette opens (incl. pre-scoped),
  // not just on later step changes — the modal's auto-focus is suppressed below.
  { immediate: true }
);

function handle(action: Parameters<typeof dispatch>[0]) {
  const intent = dispatch(action);
  emit('update:modelValue', state.value.query);
  if (intent?.kind === 'run') emit('run', state.value.query);
  if (intent?.kind === 'broaden') emit('broaden', { q: intent.q });
}

function onChooseEntry(e: EntryOption) {
  relationLabels.value[e.id] = e.entryTitle;
  handle({ kind: 'setValue', value: e.id });
  handle({ kind: 'commitValue' });
}

const ct = computed(() =>
  props.contentTypes.find((c) => c.identifier === state.value.query.contentType)
);
const placeholder = computed(() =>
  state.value.query.contentType
    ? `Filter ${ct.value?.name}…`
    : 'Search everything…'
);

// --- Chip display labels (field/operator render as display names, not raw ids) ---
function fieldByIdentifier(identifier: string) {
  return ct.value?.fields.find((f) => f.identifier === identifier);
}
function committedFieldLabel(f: SearchFilter): string {
  return fieldByIdentifier(f.field)?.name ?? f.field;
}
function committedOperatorLabel(f: SearchFilter): string {
  const type = fieldByIdentifier(f.field)?.type;
  return type ? operatorLabel(type, f.op) : f.op;
}

/**
 * Human-readable chip value: relation ids resolve to their captured title;
 * everything else stringifies. Null/undefined hides the chip's value segment.
 */
function displayValue(f: SearchFilter): string | null {
  if (f.value == null) return null;
  const key = String(f.value);
  return relationLabels.value[key] ?? key;
}

// --- Draft (in-progress) chip value input ---
const draftKind = computed(() =>
  state.value.draft
    ? valueInputKind(state.value.draft.field.type, state.value.draft.op)
    : null
);
const valuePlaceholder = computed(() => {
  switch (draftKind.value) {
    case 'entry':
      return 'Search entries…';
    case 'select':
      return 'Pick a value…';
    case 'boolean':
      return 'true / false';
    case 'datetime':
      return 'YYYY-MM-DD…';
    default:
      return 'Enter a value…';
  }
});
// Free-entry kinds carry an uncommitted typed value; entry/select/boolean commit
// via the dropdown (click), so there is no pending text to lock in for them.
const isFreeEntry = computed(
  () =>
    draftKind.value === 'text' ||
    draftKind.value === 'number' ||
    draftKind.value === 'datetime'
);

function commitTypedValue() {
  handle({ kind: 'setValue', value: state.value.text });
  handle({ kind: 'commitValue' });
}

function onValueInput(e: Event) {
  handle({ kind: 'setFreeText', q: (e.target as HTMLInputElement).value });
}
function onValueKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    // ↵ runs the search now, locking in a pending typed value first.
    if (isFreeEntry.value && state.value.text !== '') commitTypedValue();
    handle({ kind: 'run' });
  } else if (
    e.key === 'ArrowRight' &&
    isFreeEntry.value &&
    state.value.text !== ''
  ) {
    // → locks the value in and returns to the field step for the next filter.
    e.preventDefault();
    commitTypedValue();
  } else if (e.key === 'Backspace' && state.value.text === '') {
    // Empty value input + Backspace cancels the draft, back to field selection.
    handle({ kind: 'backspace' });
  }
}

// --- Main (free-text / content-type / field-pick) input ---
function onInput(e: Event) {
  handle({ kind: 'setFreeText', q: (e.target as HTMLInputElement).value });
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    handle({ kind: 'run' });
  } else if (e.key === 'Backspace' && state.value.text === '') {
    handle({ kind: 'backspace' });
  }
  // Tab / Shift+Tab intentionally fall through to native focus handling.
}
</script>

<template>
  <div
    :data-testid="testId"
    class="flex flex-col w-full rounded-2xl border border-default bg-default shadow-xl overflow-clip font-sans"
  >
    <div class="flex items-center gap-2 px-4 py-4 border-b border-default">
      <UIcon name="i-lucide-search" class="size-[18px] text-dimmed shrink-0" />
      <ContentTypeChip
        v-if="ct"
        :name="ct.name"
        :locked="state.locked"
        :test-id="QA_QUERY_BUILDER.CONTENT_TYPE_CHIP"
        @remove="handle({ kind: 'removeContentType' })"
      />
      <FilterChip
        v-for="(f, i) in state.query.filters"
        :key="i"
        :field="committedFieldLabel(f)"
        :operator="committedOperatorLabel(f)"
        :value="displayValue(f)"
        :test-id="QA_QUERY_BUILDER.FILTER_CHIP(i)"
        @remove="handle({ kind: 'removeFilter', index: i })"
      />
      <!--
        The in-progress draft renders as a chip with field + operator labels and
        an editable, auto-focused value segment — so picking a field drops a chip
        in place with the cursor on its value (per the search design).
      -->
      <FilterChip
        v-if="state.draft"
        :field="state.draft.field.name"
        :operator="operatorLabel(state.draft.field.type, state.draft.op)"
        :active-segment="'value'"
        :show-remove="false"
        :test-id="QA_QUERY_BUILDER.DRAFT_CHIP"
      >
        <template #value>
          <input
            ref="valueInput"
            :data-testid="QA_QUERY_BUILDER.VALUE_INPUT"
            style="field-sizing: content"
            class="min-w-[3rem] max-w-[16rem] bg-transparent outline-none text-xs text-highlighted placeholder:text-dimmed"
            :placeholder="valuePlaceholder"
            :value="state.text"
            @input="onValueInput"
            @keydown="onValueKeydown"
          />
        </template>
      </FilterChip>
      <input
        v-show="state.step !== 'value'"
        :id="QA_QUERY_BUILDER.INPUT"
        ref="mainInput"
        :data-testid="QA_QUERY_BUILDER.INPUT"
        role="combobox"
        :aria-expanded="true"
        class="flex-1 min-w-[6rem] bg-transparent outline-none text-[15px] text-highlighted placeholder:text-dimmed"
        :placeholder="placeholder"
        :value="state.text"
        @input="onInput"
        @keydown="onKeydown"
      />
      <UKbd value="esc" class="shrink-0" />
    </div>

    <QueryDropdown
      :state="state"
      :test-id="QA_QUERY_BUILDER.DROPDOWN"
      @run-free-text="handle({ kind: 'run' })"
      @pick-content-type="
        (id: string) =>
          handle({
            kind: 'pickContentType',
            contentType: contentTypes.find((c) => c.id === id)!,
          })
      "
      @pick-field="
        (id: string) =>
          handle({
            kind: 'pickField',
            field: ct!.fields.find((f) => f.identifier === id)!,
          })
      "
      @pick-operator="(op: string) => handle({ kind: 'pickOperator', op })"
    >
      <template #value>
        <ValueEditor
          v-if="state.draft"
          :draft="state.draft"
          :text="state.text"
          :search-entries="searchEntries"
          @set-value="(v: unknown) => handle({ kind: 'setValue', value: v })"
          @commit="handle({ kind: 'commitValue' })"
          @choose-entry="onChooseEntry"
        />
      </template>
    </QueryDropdown>

    <div
      class="flex items-center gap-4 px-4 py-3 border-t border-default text-xs text-dimmed"
      :data-testid="QA_QUERY_BUILDER.FOOTER"
    >
      <span><UKbd value="↵" /> Search</span>
      <span><UKbd value="esc" /> Close</span>
    </div>
  </div>
</template>
