import type { Ref } from 'vue';

export function useContentEntryEditor(contentTypeId: string, entryId: string) {
  const toast = useToast();
  const isNew = entryId === 'new';

  const {
    data: entry,
    status: loadingStatus,
    refresh,
  } = isNew
    ? {
        data: ref(null) as Ref<Record<string, unknown> | null>,
        status: ref('success'),
        refresh: async () => {},
      }
    : useAuthedFetch<Record<string, unknown>>(
        `/api/content-entries/${entryId}`
      );

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);
  const status = ref<string>('DRAFT');
  const hasPublishedVersion = ref(false);

  // Dirty tracking via JSON snapshot comparison
  const snapshot = ref<string>('{}');

  function takeSnapshot() {
    snapshot.value = JSON.stringify(formState);
  }

  const isDirty = computed(() => {
    return JSON.stringify(formState) !== snapshot.value;
  });

  // Populate formState for new entries and take initial snapshot
  if (isNew) {
    takeSnapshot();
  }

  watch(
    () => (entry as Ref<Record<string, unknown> | null>).value,
    (val) => {
      if (val) {
        const data = (val.data ?? {}) as Record<string, unknown>;
        // Clear existing keys then assign fresh data
        for (const key of Object.keys(formState)) {
          delete formState[key];
        }
        Object.assign(formState, data);
        status.value = (val.status as string) ?? 'DRAFT';
        hasPublishedVersion.value =
          (val.hasPublishedVersion as boolean) ?? false;
        takeSnapshot();
      }
    },
    { immediate: true }
  );

  async function saveDraft(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      const data = { ...formState };
      if (isNew) {
        const created = await $fetch<{ id: string }>('/api/content-entries', {
          method: 'POST',
          body: { contentTypeId, data },
        });
        toast.add({
          title: 'Draft saved',
          description: 'Entry created as draft.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/content-entries/${entryId}`, {
          method: 'PUT',
          body: { data },
        });
        await refresh();
        takeSnapshot();
        toast.add({
          title: 'Draft saved',
          description: 'Changes saved.',
          color: 'success',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save.';
      saveError.value = message;
      toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
      isSaving.value = false;
    }
  }

  async function publish(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      const data = { ...formState };
      if (isNew) {
        const created = await $fetch<{ id: string }>('/api/content-entries', {
          method: 'POST',
          body: { contentTypeId, data, status: 'PUBLISHED' },
        });
        toast.add({
          title: 'Published',
          description: 'Entry created and published.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/content-entries/${entryId}`, {
          method: 'PUT',
          body: { data, status: 'PUBLISHED' },
        });
        await refresh();
        takeSnapshot();
        toast.add({
          title: 'Published',
          description: 'Entry published successfully.',
          color: 'success',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to publish.';
      saveError.value = message;
      toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
      isSaving.value = false;
    }
  }

  async function discardChanges(): Promise<void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      await $fetch(`/api/content-entries/${entryId}/draft`, {
        method: 'DELETE',
      });
      await refresh();
      // formState is repopulated by the watcher on refresh
      toast.add({
        title: 'Changes discarded',
        description: 'Reverted to the published version.',
        color: 'success',
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to discard changes.';
      saveError.value = message;
      toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
      isSaving.value = false;
    }
  }

  function generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  return {
    isNew,
    entry,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    status,
    hasPublishedVersion,
    isDirty,
    saveDraft,
    publish,
    discardChanges,
    generateSlug,
  };
}
