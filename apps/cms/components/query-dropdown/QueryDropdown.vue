<script setup lang="ts">
import {
  availableOperators,
  FILTERABLE_FIELD_TYPES,
} from '~/utils/queryBuilder/operators';
import type { QueryDropdownProps } from './queryDropdown.types';
import { QA_QUERY_DROPDOWN } from './queryDropdown.config';

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
  (ct.value?.fields ?? []).filter((f) =>
    FILTERABLE_FIELD_TYPES.includes(f.type)
  )
);
const operators = computed(() =>
  props.state.draft
    ? availableOperators(props.state.draft.field.type, {
        rich: props.state.rich,
      })
    : []
);
</script>

<template>
  <div :data-testid="testId" class="flex flex-col p-2 gap-0.5">
    <button
      v-if="state.step === 'contentType' && state.text"
      type="button"
      class="flex items-center gap-2.5 h-11 px-3 rounded-lg bg-elevated text-left"
      :data-testid="QA_QUERY_DROPDOWN.FREE_TEXT_ACTION"
      @click="emit('runFreeText')"
    >
      <span
        class="flex items-center justify-center size-7 rounded-md bg-primary text-inverted"
      >
        <UIcon name="i-lucide-search" class="size-3.5" />
      </span>
      <span class="text-muted text-sm"
        >Search for
        <span class="font-semibold text-highlighted"
          >“{{ state.text }}”</span
        ></span
      >
    </button>

    <template v-if="state.step === 'contentType'">
      <div
        class="px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
      >
        Content types
      </div>
      <button
        v-for="(c, i) in typeMatches"
        :key="c.id"
        type="button"
        class="flex items-center h-12 px-3 rounded-lg text-left hover:bg-elevated"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
        @click="emit('pickContentType', c.id)"
      >
        <span class="text-highlighted text-[13px] font-medium">{{
          c.name
        }}</span>
      </button>
    </template>

    <template v-else-if="state.step === 'field'">
      <div
        class="px-3 py-1 text-[11px] font-semibold tracking-wide text-dimmed uppercase"
      >
        Filter {{ ct?.name }} by field
      </div>
      <button
        v-for="(f, i) in fields"
        :key="f.identifier"
        type="button"
        class="flex items-center justify-between h-11 px-3 rounded-lg text-left hover:bg-elevated"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
        @click="emit('pickField', f.identifier)"
      >
        <span class="text-highlighted text-[13px] font-medium">{{
          f.name
        }}</span>
      </button>
    </template>

    <template v-else-if="state.step === 'operator'">
      <button
        v-for="(o, i) in operators"
        :key="o.id"
        type="button"
        class="flex items-center justify-between h-10 px-3 rounded-lg text-left hover:bg-elevated"
        :data-testid="QA_QUERY_DROPDOWN.OPTION(i)"
        @click="emit('pickOperator', o.id)"
      >
        <span class="text-highlighted text-[13px]">{{ o.label }}</span>
        <span class="text-muted text-xs">{{ o.description }}</span>
      </button>
    </template>

    <slot v-else-if="state.step === 'value'" name="value" />
  </div>
</template>
