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

  if (isNew) {
    Object.assign(formState, { status: 'DRAFT' });
  }

  watch(
    () => (entry as Ref<Record<string, unknown> | null>).value,
    (val) => {
      if (val) {
        const data = (val.data ?? {}) as Record<string, unknown>;
        Object.assign(formState, data);
        formState.status = val.status;
      }
    },
    { immediate: true }
  );

  async function save(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      const { status, ...data } = formState;
      if (isNew) {
        const created = await $fetch<{ id: string }>('/api/content-entries', {
          method: 'POST',
          body: { contentTypeId, data, status },
        });
        toast.add({
          title: 'Created',
          description: 'Entry created successfully.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/content-entries/${entryId}`, {
          method: 'PUT',
          body: { data, status },
        });
        await refresh();
        toast.add({
          title: 'Saved',
          description: 'Changes saved successfully.',
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
    save,
    generateSlug,
  };
}
