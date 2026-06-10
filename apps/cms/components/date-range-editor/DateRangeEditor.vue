<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date';
import type { DateRangeEditorProps } from './dateRangeEditor.types';
import { QA_DATE_RANGE_EDITOR } from './dateRangeEditor.config';
import {
  dayToBoundaryIso,
  isoToCalendarDate,
  presetRange,
  DATE_PRESETS,
  type PresetId,
} from '~/utils/queryBuilder/dateFilter';

const props = withDefaults(defineProps<DateRangeEditorProps>(), {
  testId: QA_DATE_RANGE_EDITOR.COMPONENT,
});
const emit = defineEmits<{ setValue: [value: unknown]; commit: [] }>();

interface RangeModel {
  start: CalendarDate | undefined;
  end: CalendarDate | undefined;
}

// Seed from a committed [startIso, endIso] (re-edit), else empty. Bound to
// `:default-value` (uncontrolled — read once at mount); re-edit relies on the
// editor remounting per draft, not on this staying reactive.
const seed = computed<RangeModel | undefined>(() => {
  const v = props.draft.value;
  if (Array.isArray(v) && v.length === 2) {
    return {
      start: isoToCalendarDate(String(v[0])) ?? undefined,
      end: isoToCalendarDate(String(v[1])) ?? undefined,
    };
  }
  return undefined;
});

function commitRange(startIso: string, endIso: string) {
  emit('setValue', [startIso, endIso]);
  emit('commit');
}

// reka sets `start` on the first click and `end` on the second; commit when both exist.
function onSelect(value: unknown) {
  const r = value as RangeModel | null;
  if (r?.start && r?.end) {
    commitRange(
      dayToBoundaryIso(r.start, 'start'),
      dayToBoundaryIso(r.end, 'end')
    );
  }
}

function onPreset(id: PresetId) {
  const [s, e] = presetRange(id, new Date());
  commitRange(s, e);
}
</script>

<template>
  <div :data-testid="testId" class="flex justify-center gap-2 p-2">
    <div
      role="group"
      aria-label="Quick ranges"
      class="flex flex-col gap-0.5 w-32 shrink-0"
    >
      <button
        v-for="p in DATE_PRESETS"
        :key="p.id"
        type="button"
        class="h-9 px-3 rounded-lg text-left text-[13px] text-highlighted hover:bg-elevated"
        :data-testid="QA_DATE_RANGE_EDITOR.PRESET(p.id)"
        @click="onPreset(p.id)"
      >
        {{ p.label }}
      </button>
    </div>
    <UCalendar
      range
      :default-value="seed"
      initial-focus
      @update:model-value="onSelect"
    />
  </div>
</template>
