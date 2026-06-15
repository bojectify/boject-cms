<script setup lang="ts">
import {
  availableOperators,
  FILTERABLE_FIELD_TYPES,
  valueInputKind,
} from '~/utils/queryBuilder/operators';
import {
  SYSTEM_FIELDS,
  isSystemFieldId,
} from '~/utils/queryBuilder/systemFields';
import { STEPS } from '~/utils/queryBuilder/machine';
import type { QueryDropdownProps } from './queryDropdown.types';
import {
  QA_QUERY_DROPDOWN,
  QUERY_LISTBOX_ID,
  TW_QUERY_DROPDOWN,
} from './queryDropdown.config';
import {
  FIELD_TYPE_ICONS,
  FIELD_TYPE_SHORT_LABELS,
} from '~/utils/fieldTypePresentation';

const props = withDefaults(defineProps<QueryDropdownProps>(), {
  testId: QA_QUERY_DROPDOWN.COMPONENT,
});
const emit = defineEmits<{
  runFreeText: [];
  pickContentType: [id: string];
  pickField: [identifier: string];
  pickOperator: [op: string];
}>();

const typeMatches = computed(() =>
  props.state.contentTypes.filter((c) =>
    c.name.toLowerCase().includes(props.state.text.toLowerCase())
  )
);
const ct = computed(() =>
  props.state.contentTypes.find(
    (c) => c.identifier === props.state.query.contentType
  )
);
const fields = computed(() =>
  (ct.value?.fields ?? [])
    .filter((f) => FILTERABLE_FIELD_TYPES.includes(f.type))
    .filter((f) =>
      f.name.toLowerCase().includes(props.state.text.toLowerCase())
    )
);
// System (envelope) fields — offered after the type's own fields, filtered by
// the same name match. Their option ids continue the `qb-opt-field-<i>`
// sequence so the roving keyboard nav walks one flat list.
const systemFields = computed(() =>
  SYSTEM_FIELDS.filter((f) =>
    f.name.toLowerCase().includes(props.state.text.toLowerCase())
  )
);
// System fields offered BEFORE a content type is chosen (cross-type envelope
// filters). Filtered by the same name match as the type list.
const unscopedSystemFields = computed(() =>
  SYSTEM_FIELDS.filter((f) => f.unscoped).filter((f) =>
    f.name.toLowerCase().includes(props.state.text.toLowerCase())
  )
);
// The free-text "Search …" run action shows whenever the user is typing at a
// step where free text is a valid query: unscoped (contentType step) or scoped
// (field step). It is how you full-text search a content type — including by
// entry title — without picking a structured field.
const showFreeTextAction = computed(
  () =>
    !!props.state.text &&
    (props.state.step === STEPS.CONTENT_TYPE ||
      props.state.step === STEPS.FIELD)
);
const operators = computed(() =>
  props.state.draft
    ? availableOperators(props.state.draft.field.type, {
        rich: props.state.rich,
        multiValue: props.state.multiValue,
        range: props.state.range,
        // System envelope fields ($entryKey / $status / $id) are always set, so
        // they never offer the nullary presence ops (#359).
        nullary: !isSystemFieldId(props.state.draft.field.identifier),
      })
    : []
);

// At a multi-value value step the listbox holds checkbox-style rows (multiple can
// be selected), so advertise multi-selectability to assistive tech.
const isMultiValueStep = computed(() => {
  if (props.state.step !== STEPS.VALUE || !props.state.draft) return false;
  const kind = valueInputKind(
    props.state.draft.field.type,
    props.state.draft.op
  );
  return kind === 'multiSelect' || kind === 'multiEntry';
});

/** Whether an option id is the keyboard-highlighted one. */
const isActive = (id: string) => props.activeId === id;
</script>

<template>
  <div
    :id="QUERY_LISTBOX_ID"
    :data-testid="testId"
    role="listbox"
    aria-label="Search options"
    :aria-multiselectable="isMultiValueStep || undefined"
    class="flex grow min-h-0 flex-col overflow-y-auto p-2 gap-0.5"
  >
    <button
      v-if="showFreeTextAction"
      id="qb-opt-freetext"
      type="button"
      role="option"
      :aria-selected="isActive('qb-opt-freetext')"
      class="flex shrink-0 items-center gap-2.5 h-11 px-3 rounded-lg text-left"
      :class="isActive('qb-opt-freetext') ? 'bg-accented' : 'bg-elevated'"
      :data-testid="QA_QUERY_DROPDOWN.FREE_TEXT_ACTION"
      @click="emit('runFreeText')"
    >
      <span
        class="flex items-center justify-center size-7 rounded-md bg-primary text-inverted"
      >
        <UIcon name="i-lucide-search" class="size-3.5" />
      </span>
      <span class="text-muted text-sm"
        >Search<template v-if="ct"> {{ ct.name }}</template> for
        <span class="font-semibold text-highlighted"
          >“{{ state.text }}”</span
        ></span
      >
    </button>

    <template v-if="state.step === STEPS.CONTENT_TYPE">
      <template v-if="unscopedSystemFields.length">
        <div
          aria-hidden="true"
          class="shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
        >
          System
        </div>
        <button
          v-for="(f, i) in unscopedSystemFields"
          :id="`qb-opt-sys-${i}`"
          :key="f.identifier"
          type="button"
          role="option"
          :aria-selected="isActive(`qb-opt-sys-${i}`)"
          :aria-label="f.name"
          :class="[
            TW_QUERY_DROPDOWN.BUTTON,
            'gap-3',
            { 'bg-elevated': isActive(`qb-opt-sys-${i}`) },
          ]"
          :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
          @click="emit('pickField', f.identifier)"
        >
          <span :class="TW_QUERY_DROPDOWN.ICON_BOX">
            <UIcon
              :name="`i-lucide-${FIELD_TYPE_ICONS[f.type]}`"
              class="size-[15px] text-dimmed"
            />
          </span>
          <span class="grow text-highlighted text-[13px] font-medium">{{
            f.name
          }}</span>
          <span :class="TW_QUERY_DROPDOWN.PILL">{{
            FIELD_TYPE_SHORT_LABELS[f.type]
          }}</span>
        </button>
      </template>
      <div
        aria-hidden="true"
        class="shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
      >
        Content types
      </div>
      <button
        v-for="(c, i) in typeMatches"
        :id="`qb-opt-ct-${i}`"
        :key="c.id"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-ct-${i}`)"
        :class="[
          TW_QUERY_DROPDOWN.BUTTON,
          { 'bg-elevated': isActive(`qb-opt-ct-${i}`) },
        ]"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(unscopedSystemFields.length + i)"
        @click="emit('pickContentType', c.id)"
      >
        <span class="text-highlighted text-[13px] font-medium">{{
          c.name
        }}</span>
      </button>
    </template>

    <template v-else-if="state.step === STEPS.FIELD">
      <div
        aria-hidden="true"
        class="shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
      >
        Filter {{ ct?.name }} by field
      </div>
      <button
        v-for="(f, i) in fields"
        :id="`qb-opt-field-${i}`"
        :key="f.identifier"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-field-${i}`)"
        :aria-label="f.name"
        :class="[
          TW_QUERY_DROPDOWN.BUTTON,
          'gap-3',
          { 'bg-elevated': isActive(`qb-opt-field-${i}`) },
        ]"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
        @click="emit('pickField', f.identifier)"
      >
        <span :class="TW_QUERY_DROPDOWN.ICON_BOX">
          <UIcon
            :name="`i-lucide-${FIELD_TYPE_ICONS[f.type]}`"
            class="size-[15px] text-dimmed"
          />
        </span>
        <span class="grow text-highlighted text-[13px] font-medium">{{
          f.name
        }}</span>
        <span :class="TW_QUERY_DROPDOWN.PILL">{{
          FIELD_TYPE_SHORT_LABELS[f.type]
        }}</span>
      </button>
      <template v-if="systemFields.length">
        <div
          aria-hidden="true"
          class="shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
        >
          System
        </div>
        <button
          v-for="(f, i) in systemFields"
          :id="`qb-opt-field-${fields.length + i}`"
          :key="f.identifier"
          type="button"
          role="option"
          :aria-selected="isActive(`qb-opt-field-${fields.length + i}`)"
          :aria-label="f.name"
          :class="[
            TW_QUERY_DROPDOWN.BUTTON,
            'gap-3',
            { 'bg-elevated': isActive(`qb-opt-field-${fields.length + i}`) },
          ]"
          :data-testid="QA_QUERY_DROPDOWN.OPTION(fields.length + i)"
          @click="emit('pickField', f.identifier)"
        >
          <span :class="TW_QUERY_DROPDOWN.ICON_BOX">
            <UIcon
              :name="`i-lucide-${FIELD_TYPE_ICONS[f.type]}`"
              class="size-[15px] text-dimmed"
            />
          </span>
          <span class="grow text-highlighted text-[13px] font-medium">{{
            f.name
          }}</span>
          <span :class="TW_QUERY_DROPDOWN.PILL">{{
            FIELD_TYPE_SHORT_LABELS[f.type]
          }}</span>
        </button>
      </template>
    </template>

    <template v-else-if="state.step === STEPS.OPERATOR">
      <button
        v-for="(o, i) in operators"
        :id="`qb-opt-op-${i}`"
        :key="o.id"
        type="button"
        role="option"
        :aria-selected="isActive(`qb-opt-op-${i}`)"
        :class="[
          TW_QUERY_DROPDOWN.BUTTON,
          { 'bg-elevated': isActive(`qb-opt-op-${i}`) },
        ]"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
        @click="emit('pickOperator', o.id)"
      >
        <span class="text-highlighted text-[13px]">{{ o.label }}</span>
        <span class="text-muted text-xs">{{ o.description }}</span>
      </button>
    </template>

    <slot v-else-if="state.step === STEPS.VALUE" name="value" />
  </div>
</template>
