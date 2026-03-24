export function useContentEditor(modelPath: string, id: string) {
  const toast = useToast();
  const isNew = id === 'new';

  const {
    data: item,
    status: loadingStatus,
    refresh,
  } = isNew
    ? { data: ref(null), status: ref('success'), refresh: async () => {} }
    : useFetch<Record<string, unknown>>(`/api/${modelPath}/${id}`);

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);

  // In create mode, set defaults synchronously before template renders
  if (isNew) {
    Object.assign(formState, { status: 'DRAFT' });
  }

  watch(item, (val) => {
    if (val) {
      Object.assign(formState, val);
    }
  });

  async function save(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      if (isNew) {
        const created = await $fetch<{ id: string }>(`/api/${modelPath}`, {
          method: 'POST',
          body: formState,
        });
        toast.add({
          title: 'Created',
          description: 'Content created successfully.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/${modelPath}/${id}`, {
          method: 'PUT',
          body: formState,
        });
        await refresh();
        toast.add({
          title: 'Saved',
          description: 'Changes saved successfully.',
          color: 'success',
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to save changes.';
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
    item,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    save,
    generateSlug,
  };
}
