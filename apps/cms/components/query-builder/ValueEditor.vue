<script setup lang="ts">
import { valueInputKind } from '~/utils/queryBuilder/operators';
import type { DraftFilter } from '~/utils/queryBuilder/machine';
import type { EntryOption } from './queryBuilder.types';

const props = defineProps<{
  draft: DraftFilter;
  text: string;
  searchEntries?: (ids: string[], q: string) => Promise<EntryOption[]>;
}>();
const emit = defineEmits<{
  setValue: [value: unknown];
  commit: [];
  chooseEntry: [entry: EntryOption];
}>();

const kind = computed(() =>
  valueInputKind(props.draft.field.type, props.draft.op)
);
const entries = ref<EntryOption[]>([]);
watch(
  () => props.text,
  async (q) => {
    if (kind.value === 'entry' && props.searchEntries) {
      entries.value = await props.searchEntries(
        props.draft.field.targetContentTypeIds ?? [],
        q
      );
    }
  }
);
function choose(v: unknown) {
  emit('setValue', v);
  emit('commit');
}
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <template v-if="kind === 'boolean'">
      <button
        v-for="opt in [
          ['True', true],
          ['False', false],
        ]"
        :key="String(opt[1])"
        type="button"
        class="flex items-center gap-2.5 h-10 px-3 rounded-lg hover:bg-elevated text-left"
        @click="choose(opt[1])"
      >
        <span
          class="size-2 rounded-full"
          :class="opt[1] ? 'bg-success' : 'bg-muted'"
        />
        <span class="text-[13px] text-highlighted">{{ opt[0] }}</span>
      </button>
    </template>

    <template v-else-if="kind === 'select'">
      <button
        v-for="c in draft.field.choices ?? []"
        :key="c.value"
        type="button"
        class="flex items-center gap-2.5 h-10 px-3 rounded-lg hover:bg-elevated text-left"
        @click="choose(c.value)"
      >
        <span class="text-[13px] text-highlighted">{{ c.label }}</span>
      </button>
    </template>

    <template v-else-if="kind === 'entry'">
      <button
        v-for="e in entries"
        :key="e.id"
        type="button"
        class="flex items-center gap-2.5 h-12 px-3 rounded-lg hover:bg-elevated text-left"
        @click="emit('chooseEntry', e)"
      >
        <span class="text-[13px] font-medium text-highlighted">{{
          e.entryTitle
        }}</span>
        <span class="ml-auto text-[11px] text-dimmed">{{
          e.contentTypeName
        }}</span>
      </button>
    </template>

    <template v-else>
      <!-- text / number / datetime: free entry committed via → / Enter from the bar -->
      <div class="px-3 py-2 text-xs text-dimmed">
        Type a value, then <UKbd value="→" /> to add the filter.
      </div>
    </template>
  </div>
</template>
