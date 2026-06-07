<script setup lang="ts">
import { useQueryBuilder } from '~/composables/useQueryBuilder';
import QueryDropdown from './QueryDropdown.vue';
import ContentTypeChip from './ContentTypeChip.vue';
import FilterChip from './FilterChip.vue';
import type { QueryBuilderProps } from './queryBuilder.types';

const props = withDefaults(defineProps<QueryBuilderProps>(), {
  enableRichOperators: false,
});
const emit = defineEmits(['update:modelValue', 'run', 'broaden']);

const { state, dispatch } = useQueryBuilder({
  contentTypes: props.contentTypes,
  lockedContentType: props.lockedContentType,
  rich: props.enableRichOperators,
  initialQuery: props.modelValue,
});

function handle(action: Parameters<typeof dispatch>[0]) {
  const intent = dispatch(action);
  emit('update:modelValue', state.value.query);
  if (intent?.kind === 'run') emit('run', state.value.query);
  if (intent?.kind === 'broaden') emit('broaden', { q: intent.q });
}

const ct = computed(() =>
  props.contentTypes.find((c) => c.identifier === state.value.query.contentType)
);
const placeholder = computed(() =>
  state.value.query.contentType
    ? `Filter ${ct.value?.name}…`
    : 'Search everything…'
);

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
    class="flex flex-col w-[700px] rounded-2xl border border-default bg-default shadow-xl overflow-clip font-sans"
  >
    <div class="flex items-center gap-3 px-4 py-4 border-b border-default">
      <UIcon name="i-lucide-search" class="size-[18px] text-dimmed shrink-0" />
      <ContentTypeChip
        v-if="ct"
        :name="ct.name"
        :locked="state.locked"
        @remove="handle({ kind: 'removeContentType' })"
      />
      <FilterChip
        v-for="(f, i) in state.query.filters"
        :key="i"
        :field="f.field"
        :operator="f.op"
        :value="String(f.value)"
        @remove="handle({ kind: 'removeFilter', index: i })"
      />
      <input
        role="combobox"
        :aria-expanded="true"
        class="flex-1 bg-transparent outline-none text-[15px] text-highlighted placeholder:text-dimmed"
        :placeholder="placeholder"
        :value="state.text"
        @input="onInput"
        @keydown="onKeydown"
      />
      <UKbd value="esc" />
    </div>

    <QueryDropdown
      :state="state"
      @run-free-text="handle({ kind: 'run' })"
      @pick-content-type="
        (id) =>
          handle({
            kind: 'pickContentType',
            contentType: contentTypes.find((c) => c.id === id)!,
          })
      "
      @pick-field="
        (id) =>
          handle({
            kind: 'pickField',
            field: ct!.fields.find((f) => f.identifier === id)!,
          })
      "
      @pick-operator="(op) => handle({ kind: 'pickOperator', op })"
    >
      <template #value><!-- ValueEditor slot, Task 9 --></template>
    </QueryDropdown>

    <div
      class="flex items-center gap-4 px-4 py-3 border-t border-default text-xs text-dimmed"
    >
      <span><UKbd value="↵" /> Search</span>
      <span><UKbd value="esc" /> Close</span>
    </div>
  </div>
</template>
