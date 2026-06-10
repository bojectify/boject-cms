<script setup lang="ts">
import { useQueryBuilder } from '~/composables/useQueryBuilder';
import type { QueryBuilderProps, EntryOption } from './queryBuilder.types';
import type { ChipSegment } from '~/components/filter-chip/filterChip.types';
import { QA_QUERY_BUILDER } from './queryBuilder.config';
import { QUERY_LISTBOX_ID } from '../query-dropdown/queryDropdown.config';
import {
  availableOperators,
  operatorLabel,
  valueInputKind,
} from '~/utils/queryBuilder/operators';

// QueryChips / QueryDropdown / FilterChip / ValueEditor / MultiSelectEditor /
// MultiEntryEditor are auto-registered (Nuxt + Storybook scan components/), so
// they need no explicit import.

const props = withDefaults(defineProps<QueryBuilderProps>(), {
  enableRichOperators: false,
  enableMultiValueOperators: false,
  enableRangeOperators: false,
  testId: QA_QUERY_BUILDER.COMPONENT,
});
const emit = defineEmits(['update:modelValue', 'run', 'broaden']);

const { state, dispatch } = useQueryBuilder({
  contentTypes: props.contentTypes,
  lockedContentType: props.lockedContentType,
  rich: props.enableRichOperators,
  multiValue: props.enableMultiValueOperators,
  range: props.enableRangeOperators,
  initialQuery: props.modelValue,
});

// entryId -> display title, captured when a relation value is picked live in
// the palette, so the chip shows the title while the filter value stays the id
// (the engine filters relations by entry id).
const liveLabels = ref<Record<string, string>>({});
// Merge the URL-seed (props, resolved by the parent) with live picks; live
// picks win (same id→title either way).
const relationLabels = computed(() => ({
  ...props.relationLabels,
  ...liveLabels.value,
}));

const mainInput = ref<HTMLInputElement>();
const valueInput = ref<HTMLInputElement>();

// Focus the active input: the draft chip's value segment while a filter's value
// is being entered, the main input otherwise. Driven by step changes AND by a
// mouse chip removal (which does NOT change the step) — so removing a chip with
// the ✕ keeps the input focused and Enter still runs the search.
function focusActiveInput() {
  nextTick(() => {
    if (state.value.step === 'value') valueInput.value?.focus();
    else mainInput.value?.focus();
  });
}
// immediate so the input is focused when the palette opens (incl. pre-scoped),
// not just on later step changes — the modal's auto-focus is suppressed below.
watch(() => state.value.step, focusActiveInput, { immediate: true });

// Removing a chip with the mouse leaves focus on the now-gone ✕ button; re-home
// it to the active input so Enter keeps working. (removeFilter doesn't change
// the step, so the focus watcher wouldn't otherwise fire.)
function onRemoveFilter(index: number) {
  handle({ kind: 'removeFilter', index });
  focusActiveInput();
}
function onRemoveContentType() {
  handle({ kind: 'removeContentType' });
  focusActiveInput();
}

function handle(action: Parameters<typeof dispatch>[0]) {
  const intent = dispatch(action);
  emit('update:modelValue', state.value.query);
  if (intent?.kind === 'run') emit('run', state.value.query);
  if (intent?.kind === 'broaden') emit('broaden', { q: intent.q });
}

// --- Roving keyboard navigation over the dropdown's [role=option] list ---
const activeId = ref<string | null>(null);

// Reset the highlight whenever the option list changes (new step, or typing
// re-filters it) — so typing never leaves a stale highlight and Space stays a
// literal space while you type (it only activates an option when one is active).
// Exception: when re-editing a committed filter's operator, pre-highlight the
// current operator so ↑/↓/Enter start from it and it reads as the selected one.
watch([() => state.value.step, () => state.value.text], () => {
  const s = state.value;
  if (s.step === 'operator' && s.editingIndex !== null && s.draft) {
    const ops = availableOperators(s.draft.field.type, {
      rich: s.rich,
      multiValue: s.multiValue,
      range: s.range,
    });
    const idx = ops.findIndex((o) => o.id === s.draft!.op);
    // Option id mirrors QueryDropdown's `qb-opt-op-<i>` operator-row convention.
    activeId.value = idx >= 0 ? `qb-opt-op-${idx}` : null;
  } else {
    activeId.value = null;
  }
});

function listboxOptionIds(): string[] {
  if (typeof document === 'undefined') return [];
  const root = document.getElementById(QUERY_LISTBOX_ID);
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).map(
        (el) => el.id
      )
    : [];
}
function moveActive(delta: number) {
  const ids = listboxOptionIds();
  if (!ids.length) {
    activeId.value = null;
    return;
  }
  const cur = activeId.value ? ids.indexOf(activeId.value) : -1;
  const next = (cur + delta + ids.length) % ids.length;
  activeId.value = ids[next] ?? null;
  nextTick(() => {
    if (activeId.value) {
      document
        .getElementById(activeId.value)
        ?.scrollIntoView({ block: 'nearest' });
    }
  });
}
function activateActive(): boolean {
  if (!activeId.value) return false;
  const el = document.getElementById(activeId.value);
  if (!el) return false;
  el.click(); // fires the option's @click (pickField / chooseEntry / runFreeText…)
  return true;
}
/**
 * Option-list keys shared by both inputs: ↑/↓ move the highlight; Space (only
 * when an option is highlighted) and Enter activate it. Returns true if handled.
 */
function handleNavKeys(e: KeyboardEvent): boolean {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActive(1);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActive(-1);
    return true;
  }
  // Space activates the highlighted option — but ONLY when one is highlighted;
  // otherwise it's a literal space the user is typing.
  if (e.key === ' ' && activeId.value) {
    e.preventDefault();
    activateActive();
    return true;
  }
  // Enter picks the highlighted option as a convenience; with nothing
  // highlighted it falls through to the input's run/commit handler.
  if (e.key === 'Enter' && activeId.value) {
    e.preventDefault();
    activateActive();
    return true;
  }
  return false;
}
/** "Open" a field/type, "Select" a value — matching the design's Space label. */
const activeSpaceLabel = computed(() =>
  state.value.step === 'field' || state.value.step === 'contentType'
    ? 'Open'
    : 'Select'
);

function onChooseEntry(e: EntryOption) {
  liveLabels.value[e.id] = e.entryTitle;
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
    case 'multiSelect':
      return 'Pick values…';
    case 'multiEntry':
      return 'Search entries…';
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

/** True when the caret sits at the very end of the input with no selection. */
function caretAtEnd(e: KeyboardEvent): boolean {
  const el = e.target as HTMLInputElement;
  return (
    el.selectionStart === el.selectionEnd &&
    el.selectionStart === el.value.length
  );
}

function onValueInput(e: Event) {
  handle({ kind: 'setFreeText', q: (e.target as HTMLInputElement).value });
}
function onValueKeydown(e: KeyboardEvent) {
  const multi =
    draftKind.value === 'multiSelect' || draftKind.value === 'multiEntry';
  // Multi-value: Enter commits the accumulated array + runs (Space still toggles a
  // row via handleNavKeys → activateActive → the row's @click). Handle Enter before
  // handleNavKeys so a highlighted row isn't toggled instead of committing. Only
  // commit a non-empty selection — Enter with nothing toggled abandons the draft
  // and just runs (an empty `in`/`containsAny` would serialize to a degenerate
  // `field:in:` → `IN ['']`), mirroring single-value Enter on an empty input.
  if (multi && e.key === 'Enter') {
    e.preventDefault();
    const val = state.value.draft?.value;
    if (Array.isArray(val) && val.length > 0) handle({ kind: 'commitValue' });
    handle({ kind: 'run' });
    return;
  }
  if (handleNavKeys(e)) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    // ↵ runs the search now, locking in a pending typed value first.
    if (isFreeEntry.value && state.value.text !== '') commitTypedValue();
    handle({ kind: 'run' });
  } else if (
    e.key === 'Tab' &&
    !e.shiftKey &&
    isFreeEntry.value &&
    state.value.text !== ''
  ) {
    // Tab adds this filter and continues with the next (Shift+Tab stays native).
    e.preventDefault();
    commitTypedValue();
  } else if (
    e.key === 'ArrowRight' &&
    isFreeEntry.value &&
    state.value.text !== '' &&
    caretAtEnd(e)
  ) {
    // → locks the value in and returns to the field step for the next filter —
    // but ONLY at the end of the text, so mid-value arrows still move the caret
    // (editing a multi-word value otherwise fights the commit gesture).
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
  if (handleNavKeys(e)) return;
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
      <QueryChips
        :content-type-name="ct?.name"
        :locked="state.locked"
        :filters="state.query.filters"
        :fields="ct?.fields ?? []"
        :relation-labels="relationLabels"
        :relation-labels-pending="relationLabelsPending"
        :editing-index="state.editingIndex"
        @remove-content-type="onRemoveContentType"
        @remove-filter="onRemoveFilter"
        @edit-segment="
          (i: number, seg: ChipSegment) =>
            handle({ kind: 'editFilter', index: i, segment: seg })
        "
      />
      <!--
        The draft chip — a NEW filter being added OR an existing one being
        re-edited — renders with field + operator labels and an editable,
        auto-focused value segment (so picking/editing lands the cursor on the
        value). Keeping the value input here (one element, not in the v-for)
        keeps `valueInput` a single ref rather than a per-row array.
      -->
      <FilterChip
        v-if="state.draft"
        :field="state.draft.field.name"
        :operator="operatorLabel(state.draft.field.type, state.draft.op)"
        :active-segment="state.step === 'operator' ? 'operator' : 'value'"
        :show-remove="false"
        :test-id="QA_QUERY_BUILDER.DRAFT_CHIP"
      >
        <template #value>
          <input
            ref="valueInput"
            :data-testid="QA_QUERY_BUILDER.VALUE_INPUT"
            role="combobox"
            :aria-expanded="true"
            :aria-controls="QUERY_LISTBOX_ID"
            :aria-activedescendant="activeId ?? undefined"
            autocomplete="off"
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
        :aria-controls="QUERY_LISTBOX_ID"
        :aria-activedescendant="activeId ?? undefined"
        autocomplete="off"
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
      :active-id="activeId"
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
        <MultiSelectEditor
          v-if="draftKind === 'multiSelect' && state.draft"
          :draft="state.draft"
          :active-id="activeId"
          @toggle="(v: string) => handle({ kind: 'toggleValue', value: v })"
        />
        <MultiEntryEditor
          v-else-if="draftKind === 'multiEntry' && state.draft"
          :draft="state.draft"
          :text="state.text"
          :active-id="activeId"
          :search-entries="searchEntries"
          @toggle="(v: string) => handle({ kind: 'toggleValue', value: v })"
          @capture-label="
            (p: { id: string; title: string }) => (liveLabels[p.id] = p.title)
          "
        />
        <ValueEditor
          v-else-if="state.draft"
          :draft="state.draft"
          :text="state.text"
          :active-id="activeId"
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
      <span><UKbd value="↑" /><UKbd value="↓" /> Navigate</span>
      <span v-if="activeId"><UKbd>Space</UKbd> {{ activeSpaceLabel }}</span>
      <span><UKbd value="↵" /> {{ activeId ? 'Select' : 'Search' }}</span>
      <span><UKbd value="esc" /> Close</span>
    </div>
  </div>
</template>
