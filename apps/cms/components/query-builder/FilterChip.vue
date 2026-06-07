<script setup lang="ts">
defineProps<{
  field: string;
  operator: string;
  value?: string | null;
  /** which segment shows the focus ring */
  activeSegment?: 'field' | 'operator' | 'value' | null;
}>();
const emit = defineEmits<{
  remove: [];
  editSegment: [segment: 'field' | 'operator' | 'value'];
}>();
function ringIf(seg: string, active?: string | null) {
  return active === seg ? 'bg-elevated ring-2 ring-inset ring-primary' : '';
}
</script>

<template>
  <div
    class="flex items-stretch h-7 rounded-lg border border-default overflow-clip text-xs"
  >
    <button
      type="button"
      data-segment="field"
      :class="[
        'px-2 flex items-center font-semibold text-highlighted',
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
      class="px-1.5 flex items-center text-dimmed hover:text-highlighted"
      @click="emit('remove')"
    >
      <UIcon name="i-lucide-x" class="size-3" />
    </button>
  </div>
</template>
