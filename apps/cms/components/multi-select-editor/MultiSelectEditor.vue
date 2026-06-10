<script setup lang="ts">
import type { MultiSelectEditorProps } from './multiSelectEditor.types';
import { QA_MULTI_SELECT_EDITOR } from './multiSelectEditor.config';
import { useMultiSelect } from '~/composables/useMultiSelect';

const props = withDefaults(defineProps<MultiSelectEditorProps>(), {
  testId: QA_MULTI_SELECT_EDITOR.COMPONENT,
});
const emit = defineEmits<{ toggle: [value: string] }>();

const draftRef = computed(() => props.draft);
const { isSelected } = useMultiSelect(draftRef);
const choices = computed(() => props.draft.field.choices ?? []);
const isActive = (id: string) => props.activeId === id;
</script>

<template>
  <div :data-testid="testId" class="flex flex-col gap-0.5">
    <button
      v-for="(c, i) in choices"
      :id="`qb-opt-msel-${i}`"
      :key="c.value"
      type="button"
      role="option"
      :aria-selected="isSelected(c.value)"
      class="flex items-center gap-2.5 h-10 px-3 rounded-lg hover:bg-elevated text-left"
      :class="{ 'bg-elevated': isActive(`qb-opt-msel-${i}`) }"
      :data-testid="QA_MULTI_SELECT_EDITOR.OPTION(i)"
      @click="emit('toggle', c.value)"
    >
      <span
        class="flex items-center justify-center size-4 rounded border border-default shrink-0"
        :class="isSelected(c.value) ? 'bg-primary border-primary' : ''"
      >
        <UIcon
          v-if="isSelected(c.value)"
          name="i-lucide-check"
          class="size-3 text-inverted"
        />
      </span>
      <span class="text-[13px] text-highlighted">{{ c.label }}</span>
    </button>
  </div>
</template>
