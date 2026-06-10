import type { Ref } from 'vue';
import type { DraftFilter } from '~/utils/queryBuilder/machine';

/**
 * Shared selection state for the multi-value (list) editors: the normalized
 * selected array off the draft + an is-selected check. Toggling is dispatched to
 * the machine (`toggleValue`) by the consuming component, so this is read-only.
 */
export function useMultiSelect(draft: Ref<DraftFilter | null>) {
  const selected = computed<string[]>(() =>
    Array.isArray(draft.value?.value) ? (draft.value!.value as string[]) : []
  );
  const isSelected = (v: string) => selected.value.includes(v);
  return { selected, isSelected };
}
