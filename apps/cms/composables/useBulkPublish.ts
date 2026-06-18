import { ref, watch, toValue } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { useRowSelection, type RowLike } from './useRowSelection';

interface BulkPublishResponse {
  published: number;
  failed: number;
}

/**
 * Row selection + bulk-publish wiring for the search results pages. Owns the
 * selection, the busy flag, and the publish handler. Clears the selection
 * whenever the visible row set changes (pagination OR a filter/query change
 * re-runs the search), so a bulk action never targets now-invisible ids from a
 * prior result set — this is the consumer-clears contract useRowSelection
 * documents, centralised here so both pages share one definition.
 */
export function useBulkPublish(
  rows: MaybeRefOrGetter<RowLike[]>,
  refreshSearch: () => Promise<unknown> | unknown
) {
  const selection = useRowSelection(rows);
  const toast = useToast();
  const busy = ref(false);

  watch(
    () => toValue(rows),
    () => selection.clear()
  );

  async function publish() {
    const ids = [...selection.selected.value];
    if (!ids.length) return;
    busy.value = true;
    try {
      const res = await $fetch<BulkPublishResponse>(
        '/api/entries/bulk-publish',
        { method: 'POST', body: { ids } }
      );
      toast.add(
        res.failed === 0
          ? { title: `${res.published} published`, color: 'success' }
          : {
              title: `${res.published} of ${ids.length} published`,
              description: `${res.failed} failed`,
              color: 'warning',
            }
      );
      selection.clear();
      await refreshSearch();
    } catch {
      toast.add({ title: 'Bulk publish failed', color: 'error' });
    } finally {
      busy.value = false;
    }
  }

  return { selection, busy, publish };
}
