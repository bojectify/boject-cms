import { ref, computed, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

export interface RowLike {
  id: string;
}

/**
 * Page-scoped row selection for a results table. `click` toggles a row and sets
 * the anchor; `shift+click` turns ON the inclusive range from the anchor to the
 * target (the anchor stays put, so further shift-clicks re-range from it — the
 * macOS/GitHub model) and never deselects. Selection is the current page's set;
 * the page clears it on navigation, so no cross-page pruning is needed.
 */
export function useRowSelection(rows: MaybeRefOrGetter<RowLike[]>) {
  const selected = ref<Set<string>>(new Set());
  const anchorIndex = ref<number | null>(null);
  const ids = computed(() => toValue(rows).map((r) => r.id));

  const isSelected = (id: string) => selected.value.has(id);

  const count = computed(() => selected.value.size);
  const allSelected = computed(
    () =>
      ids.value.length > 0 && ids.value.every((id) => selected.value.has(id))
  );
  const indeterminate = computed(() => count.value > 0 && !allSelected.value);

  function toggle(id: string, index: number, shiftKey: boolean): void {
    if (shiftKey && anchorIndex.value !== null) {
      const lo = Math.min(anchorIndex.value, index);
      const hi = Math.max(anchorIndex.value, index);
      const next = new Set(selected.value);
      for (let i = lo; i <= hi; i++) {
        const rid = ids.value[i];
        if (rid) next.add(rid); // range turns ON, never off
      }
      selected.value = next;
      return; // anchor unchanged
    }
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
    anchorIndex.value = index;
  }

  function toggleAll(): void {
    selected.value = allSelected.value ? new Set() : new Set(ids.value);
    anchorIndex.value = null;
  }

  function clear(): void {
    selected.value = new Set();
    anchorIndex.value = null;
  }

  return {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    count,
    allSelected,
    indeterminate,
  };
}
