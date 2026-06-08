<script setup lang="ts">
import type { FilterChipProps, ChipSegment } from './filterChip.types';
import { QA_FILTER_CHIP } from './filterChip.config';

withDefaults(defineProps<FilterChipProps>(), {
  testId: QA_FILTER_CHIP.COMPONENT,
});
const emit = defineEmits<{
  remove: [];
  editSegment: [segment: ChipSegment];
}>();

function ringIf(seg: ChipSegment, active?: ChipSegment | null) {
  return active === seg ? 'bg-elevated ring-2 ring-inset ring-primary' : '';
}
</script>

<template>
  <!--
    inline-flex + shrink-0 hugs the chip to its content inside the search bar's
    flex row. The edge segments carry the rounding (instead of `overflow-clip`
    on the wrapper) so the active segment's inset focus ring follows the rounded
    corner rather than being clipped by it.
  -->
  <div
    :data-testid="testId"
    class="inline-flex shrink-0 items-stretch h-7 rounded-lg border border-default text-xs"
  >
    <button
      type="button"
      data-segment="field"
      :data-testid="QA_FILTER_CHIP.FIELD_SEGMENT"
      :class="[
        'px-2 flex items-center rounded-l-[7px] font-semibold text-highlighted',
        ringIf('field', activeSegment),
      ]"
      @click="emit('editSegment', 'field')"
    >
      {{ field }}
    </button>
    <div class="w-px self-stretch bg-default" />
    <button
      type="button"
      data-segment="operator"
      :data-testid="QA_FILTER_CHIP.OPERATOR_SEGMENT"
      :class="[
        'px-2 flex items-center text-muted',
        ringIf('operator', activeSegment),
      ]"
      @click="emit('editSegment', 'operator')"
    >
      {{ operator }}
    </button>
    <template v-if="value != null">
      <div class="w-px self-stretch bg-default" />
      <button
        type="button"
        data-segment="value"
        :data-testid="QA_FILTER_CHIP.VALUE_SEGMENT"
        :class="[
          'px-2 flex items-center text-highlighted',
          ringIf('value', activeSegment),
        ]"
        @click="emit('editSegment', 'value')"
      >
        {{ value }}
      </button>
    </template>
    <div class="w-px self-stretch bg-default" />
    <button
      type="button"
      aria-label="Remove filter"
      :data-testid="QA_FILTER_CHIP.REMOVE_BUTTON"
      class="px-1.5 flex items-center rounded-r-[7px] text-dimmed hover:text-highlighted"
      @click="emit('remove')"
    >
      <UIcon name="i-lucide-x" class="size-3" />
    </button>
  </div>
</template>
