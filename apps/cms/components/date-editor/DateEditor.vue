<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date';
import type { DateEditorProps } from './dateEditor.types';
import { QA_DATE_EDITOR } from './dateEditor.config';
import {
  dayToBoundaryIso,
  isoToCalendarDate,
} from '~/utils/queryBuilder/dateFilter';
import { OPERATORS } from '~/utils/queryBuilder/operators';

const props = withDefaults(defineProps<DateEditorProps>(), {
  testId: QA_DATE_EDITOR.COMPONENT,
});
const emit = defineEmits<{ setValue: [value: unknown]; commit: [] }>();

// Seed the visible month from a committed value (re-edit), else the current month.
// Bound to `:default-value` (uncontrolled — read once at mount), so re-edit relies
// on the editor remounting per draft, not on this staying reactive. `edge` (below)
// is what carries a live op change (before↔after) into the emitted boundary.
const seed = computed<CalendarDate | undefined>(() =>
  typeof props.draft.value === 'string'
    ? (isoToCalendarDate(props.draft.value) ?? undefined)
    : undefined
);

// `before` filters on the start of the picked day; `after` on the end of it.
const edge = computed<'start' | 'end'>(() =>
  props.draft.op === OPERATORS.AFTER ? 'end' : 'start'
);

function onSelect(value: unknown) {
  const cd = value as CalendarDate | null;
  if (!cd) return;
  emit('setValue', dayToBoundaryIso(cd, edge.value));
  emit('commit');
}
</script>

<template>
  <!-- w-fit keeps the calendar at its natural width instead of stretching to fill
       the full-width dropdown (matching the compact range calendar); mx-auto then
       centres it in the dropdown. -->
  <div :data-testid="testId" class="p-2 w-fit mx-auto">
    <UCalendar
      :default-value="seed"
      initial-focus
      @update:model-value="onSelect"
    />
  </div>
</template>
