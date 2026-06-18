import type { MaybeRefOrGetter } from 'vue';
import { slugify } from '~/utils/slugify';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '~/utils/contentStatus';

export function useContentEntryEditor(
  contentTypeId: MaybeRefOrGetter<string>,
  entryId: MaybeRefOrGetter<string>,
  fields?: MaybeRefOrGetter<
    Array<{ identifier: string; type: string; options: unknown }>
  >
) {
  const toast = useToast();
  const contentTypeIdRef = computed(() => toValue(contentTypeId));
  const entryIdRef = computed(() => toValue(entryId));
  const isNew = computed(() => entryIdRef.value === 'new');

  const entry = ref<Record<string, unknown> | null>(null);
  const loadingStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle');

  async function loadEntry() {
    if (isNew.value) {
      entry.value = null;
      loadingStatus.value = 'success';
      return;
    }
    loadingStatus.value = 'pending';
    try {
      entry.value = await useRequestFetch()<Record<string, unknown>>(
        `/api/entries/${entryIdRef.value}`
      );
      loadingStatus.value = 'success';
    } catch {
      entry.value = null;
      loadingStatus.value = 'error';
    }
  }

  async function refresh() {
    await loadEntry();
  }

  watch(entryIdRef, loadEntry, { immediate: true });

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);
  const fieldErrors = ref<Record<string, string>>({});
  const status = ref<ContentStatusName>(CONTENT_STATUSES.DRAFT);
  const hasPublishedVersion = ref(false);
  const hasArchivedVersion = ref(false);
  const publishedAt = ref<string | null>(null);
  const createdAt = ref<string | null>(null);
  const updatedAt = ref<string | null>(null);

  // Dirty tracking via JSON snapshot comparison
  const snapshot = ref<string>('{}');

  function takeSnapshot() {
    snapshot.value = JSON.stringify(formState);
  }

  const isDirty = computed(() => {
    return JSON.stringify(formState) !== snapshot.value;
  });

  // For a NEW entry, seed each supported field's configured default as the
  // initial form value (#344), then snapshot so the default is the clean
  // baseline (not flagged dirty). Existing entries hydrate from the fetched
  // version below.
  if (isNew.value) {
    Object.assign(formState, defaultsForFields(toValue(fields) ?? []));
    takeSnapshot();
  }

  watch(
    entry,
    (val) => {
      if (val) {
        const data = (val.data ?? {}) as Record<string, unknown>;
        // Clear existing keys then assign fresh data
        for (const key of Object.keys(formState)) {
          Reflect.deleteProperty(formState, key);
        }
        Object.assign(formState, data);
        status.value =
          (val.status as ContentStatusName) ?? CONTENT_STATUSES.DRAFT;
        hasPublishedVersion.value =
          (val.hasPublishedVersion as boolean) ?? false;
        hasArchivedVersion.value = (val.hasArchivedVersion as boolean) ?? false;
        publishedAt.value =
          (val.publishedVersionPublishedAt as string | null) ?? null;
        createdAt.value = (val.createdAt as string | null) ?? null;
        updatedAt.value = (val.updatedAt as string | null) ?? null;
        takeSnapshot();
      }
    },
    { immediate: true }
  );

  async function saveDraft(): Promise<string | undefined> {
    isSaving.value = true;
    saveError.value = null;
    fieldErrors.value = {};
    try {
      const data = { ...formState };
      if (isNew.value) {
        const created = await $fetch<{ id: string }>('/api/entries', {
          method: 'POST',
          body: { contentTypeId: contentTypeIdRef.value, data },
        });
        toast.add({
          title: 'Draft saved',
          description: 'Entry created as draft.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/entries/${entryIdRef.value}`, {
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
      const conflict = parseUniqueConflict(err);
      if (conflict?.kind === 'entry') {
        fieldErrors.value = {
          ...fieldErrors.value,
          [conflict.field]: conflict.message,
        };
        saveError.value = conflict.message;
        toast.add({
          title: 'Duplicate value',
          description: conflict.message,
          color: 'error',
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to save.';
      saveError.value = message;
      toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
      isSaving.value = false;
    }
  }

  async function publish(): Promise<string | undefined> {
    isSaving.value = true;
    saveError.value = null;
    fieldErrors.value = {};
    try {
      const data = { ...formState };
      if (isNew.value) {
        const created = await $fetch<{ id: string }>('/api/entries', {
          method: 'POST',
          body: {
            contentTypeId: contentTypeIdRef.value,
            data,
            status: CONTENT_STATUSES.PUBLISHED,
          },
        });
        toast.add({
          title: 'Published',
          description: 'Entry created and published.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/entries/${entryIdRef.value}`, {
          method: 'PUT',
          body: { data, status: CONTENT_STATUSES.PUBLISHED },
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
      const conflict = parseUniqueConflict(err);
      if (conflict?.kind === 'entry') {
        fieldErrors.value = {
          ...fieldErrors.value,
          [conflict.field]: conflict.message,
        };
        saveError.value = conflict.message;
        toast.add({
          title: 'Duplicate value',
          description: conflict.message,
          color: 'error',
        });
        return;
      }
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
      await $fetch(`/api/entries/${entryIdRef.value}/draft`, {
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

  // Re-export the shared algorithm so the composable's public surface
  // is unchanged. See apps/cms/utils/slugify.ts.
  const generateSlug = slugify;

  return {
    isNew,
    entry,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    fieldErrors,
    status,
    hasPublishedVersion,
    hasArchivedVersion,
    publishedAt,
    createdAt,
    updatedAt,
    isDirty,
    refresh,
    saveDraft,
    publish,
    discardChanges,
    generateSlug,
  };
}
