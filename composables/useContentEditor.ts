export function useContentEditor(modelPath: string, id: string) {
  const toast = useToast();

  const {
    data: item,
    status: loadingStatus,
    refresh,
  } = useFetch<Record<string, unknown>>(`/api/${modelPath}/${id}`);

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);

  watch(item, (val) => {
    if (val) {
      Object.assign(formState, val);
    }
  });

  async function save() {
    isSaving.value = true;
    saveError.value = null;
    try {
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
    item,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    save,
    generateSlug,
  };
}
