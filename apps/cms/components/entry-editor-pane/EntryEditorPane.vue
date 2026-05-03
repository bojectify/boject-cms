<script setup lang="ts">
import { inject } from 'vue';
import type { FieldConfig } from '~/types/contentEditor';
import { paneOrchestratorKey } from '~/composables/paneOrchestrator';
import type { EntryAction } from '~/components/entry-action-menu/entryActionMenu.types';
import type { EntryEditorPaneProps } from './entryEditorPane.types';
import { QA_ENTRY_EDITOR_PANE } from './entryEditorPane.config';

const props = withDefaults(defineProps<EntryEditorPaneProps>(), {
  testId: QA_ENTRY_EDITOR_PANE.COMPONENT,
  isTopmost: true,
});

const titleId = useId();

const orchestrator = inject(paneOrchestratorKey);
if (!orchestrator) {
  throw new Error(
    'EntryEditorPane requires a paneOrchestrator provided by its ancestor.'
  );
}

const emit = defineEmits<{
  close: [];
  saved: [data: { contentTypeId: string; entryId: string; entryTitle: string }];
  deleted: [data: { contentTypeId: string; entryId: string }];
}>();

type ContentTypeShape = {
  id: string;
  name: string;
  identifier: string;
  fields: Array<{
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
  }>;
};

// Entry editor composable (fetches the entry when editing existing)
const {
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
  refresh: refreshEntry,
  saveDraft,
  publish,
  discardChanges,
  generateSlug,
} = useContentEntryEditor(
  () => props.contentTypeId ?? '',
  () => props.entryId ?? 'new'
);

// For existing entries, derive the content type from the entry response.
// For new entries, fetch /api/content-types/:id directly.
// Conditional URL: return null to skip the fetch (Nuxt useFetch behaviour).
// The `as string` cast is required because Nuxt's type signature doesn't
// expose the null-skip behaviour, but it works at runtime.
const { data: contentTypeFromApi } = useAuthedFetch<ContentTypeShape>(
  (() => {
    if (props.entryId) return null;
    if (!props.contentTypeId) return null;
    return `/api/content-types/${props.contentTypeId}`;
  }) as () => string,
  {
    watch: [() => props.contentTypeId, () => props.entryId],
  }
);

const contentTypeFromEntry = computed<ContentTypeShape | null>(() => {
  const ct = (entry.value as { contentType?: ContentTypeShape } | null)
    ?.contentType;
  return ct ?? null;
});

const contentType = computed<ContentTypeShape | null>(() => {
  if (props.entryId) return contentTypeFromEntry.value;
  return (contentTypeFromApi.value as ContentTypeShape | null) ?? null;
});

const resolvedContentTypeId = computed(
  () => contentType.value?.id ?? props.contentTypeId ?? ''
);

const slugFieldIdentifier = computed(
  () =>
    contentType.value?.fields.find((f) => f.type === 'SLUG')?.identifier ?? null
);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.identifier ?? 'title';
});

const editorFields = computed<FieldConfig[]>(() => {
  if (!contentType.value) return [];
  return contentType.value.fields.map((f) => mapFieldToConfig(f));
});

const {
  resolvedRelations,
  resolvedMultiRelations,
  getRelationValue,
  getMultiRelationValue,
  getTargetContentTypeIds,
  applyFieldUpdate,
  purgeReference,
} = useRelationFieldState(formState, editorFields);

function handleRelationEdit(value: unknown, fieldKey: string) {
  const ref = getRelationValue(value);
  if (ref) {
    orchestrator!.openPane(
      ref.contentTypeId,
      ref.entryId,
      fieldKey,
      props.depth
    );
  }
}

watch(
  () => formState[entryTitleFieldIdentifier.value],
  (val) => {
    const slugKey = slugFieldIdentifier.value;
    if (isNew.value && typeof val === 'string' && slugKey) {
      formState[slugKey] = generateSlug(val);
    }
  }
);

const pageTitle = computed(() => {
  if (!props.entryId) return `New ${contentType.value?.name ?? 'Entry'}`;
  const titleVal = formState[entryTitleFieldIdentifier.value];
  if (typeof titleVal === 'string' && titleVal) return titleVal;
  return contentType.value?.name ?? 'Entry';
});

const editorRef = useTemplateRef<{ validate: () => Promise<boolean> }>(
  'editorRef'
);

function emitSaved(newId: string | undefined) {
  const entryId = newId ?? props.entryId;
  if (entryId) {
    const titleVal = formState[entryTitleFieldIdentifier.value];
    emit('saved', {
      contentTypeId: resolvedContentTypeId.value,
      entryId,
      entryTitle: typeof titleVal === 'string' ? titleVal : 'Untitled',
    });
  }
}

async function handleSaveDraft() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await saveDraft();
  await editorRef.value?.validate();
  emitSaved(newId);
}

async function handlePublish() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await publish();
  await editorRef.value?.validate();
  emitSaved(newId);
}

async function handleDiscardChanges() {
  await discardChanges();
}

const toast = useToast();

async function handleDelete() {
  if (!props.entryId) return;
  const titleVal = formState[entryTitleFieldIdentifier.value];
  const label =
    typeof titleVal === 'string' && titleVal ? titleVal : 'this entry';
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/content-entries/${props.entryId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        statusMessage?: string;
        message?: string;
      } | null;
      throw new Error(
        body?.statusMessage ?? body?.message ?? `Request failed (${res.status})`
      );
    }
    toast.add({
      title: 'Deleted',
      description: `${label} was deleted.`,
      color: 'success',
    });
    emit('deleted', {
      contentTypeId: resolvedContentTypeId.value,
      entryId: props.entryId,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete entry.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function handleAction(action: EntryAction) {
  if (!props.entryId) return;
  if (action === 'delete') {
    await handleDelete();
    return;
  }
  const endpointByAction: Record<
    Exclude<EntryAction, 'delete'>,
    { path: string; successTitle: string; successBody: string }
  > = {
    unpublish: {
      path: 'unpublish',
      successTitle: 'Unpublished',
      successBody: 'Entry is no longer published.',
    },
    republish: {
      path: 'republish',
      successTitle: 'Republished',
      successBody: 'Entry has been republished.',
    },
    archive: {
      path: 'archive',
      successTitle: 'Archived',
      successBody: 'Entry has been archived.',
    },
    unarchive: {
      path: 'unarchive',
      successTitle: 'Unarchived',
      successBody: 'Entry has been unarchived.',
    },
  };
  const spec = endpointByAction[action];
  try {
    await $fetch(`/api/content-entries/${props.entryId}/${spec.path}`, {
      method: 'POST',
    });
    await refreshEntry();
    toast.add({
      title: spec.successTitle,
      description: spec.successBody,
      color: 'success',
    });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    const data = (err as { data?: { error?: string } })?.data;
    if (action === 'archive' && statusCode === 409) {
      const msg =
        data?.error === 'DRAFT_PRESENT'
          ? 'Discard the draft before archiving this entry.'
          : ((err as { statusMessage?: string })?.statusMessage ??
            'Cannot archive entry right now.');
      toast.add({ title: 'Cannot archive', description: msg, color: 'error' });
      return;
    }
    const message =
      (err as { statusMessage?: string })?.statusMessage ??
      (err instanceof Error ? err.message : `Failed to ${action} entry.`);
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

defineExpose({ isDirty, applyFieldUpdate, purgeReference });

const { contentRef } = useDialogA11y({
  active: () => props.open && props.isTopmost,
  onEscape: () => emit('close'),
});
</script>

<template>
  <Transition name="slide-pane">
    <div
      v-if="open"
      ref="contentRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="absolute inset-0 z-30 flex focus:outline-none"
      :data-testid="testId"
    >
      <!-- Backdrop / sliver -->
      <button
        type="button"
        aria-label="Close pane"
        class="w-10 shrink-0 bg-gray-200/50 dark:bg-gray-900/50 backdrop-blur-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
        @click="emit('close')"
      />
      <!-- Pane -->
      <div
        class="flex-1 flex flex-col bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center gap-4 px-6 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0"
        >
          <UButton
            variant="ghost"
            icon="i-lucide-arrow-left"
            size="sm"
            aria-label="Close pane"
            @click="emit('close')"
          />
          <USeparator orientation="vertical" class="h-4" />
          <NuxtLink
            :to="`/content-types/${resolvedContentTypeId}`"
            target="_blank"
            class="flex items-center gap-1.5 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {{ contentType?.name ?? 'Content Type' }}
            <UIcon name="i-lucide-external-link" class="size-3" />
          </NuxtLink>
          <div class="flex-1" />
          <span :id="titleId" class="text-sm font-semibold">{{
            pageTitle
          }}</span>
          <div class="flex-1" />
        </div>
        <!-- Body: editor + sidebar -->
        <div class="flex-1 flex overflow-hidden">
          <div class="flex-1 overflow-y-auto">
            <ContentEditor
              ref="editorRef"
              v-model:state="formState"
              :title="pageTitle"
              :fields="editorFields"
              :loading="loadingStatus === 'pending'"
              :error="saveError"
              :field-errors="fieldErrors"
            >
              <template #field="{ field, value, update }">
                <RelationField
                  v-if="field.type === 'dynamic-relation'"
                  :label="field.label"
                  :required="field.required"
                  :value="getRelationValue(value)"
                  :entry-title="
                    resolvedRelations[field.key]?.entryTitle ?? null
                  "
                  :content-type-name="
                    resolvedRelations[field.key]?.contentTypeName ?? null
                  "
                  @add="
                    orchestrator.openPicker(
                      field.key,
                      getTargetContentTypeIds(field),
                      props.depth
                    )
                  "
                  @edit="handleRelationEdit(value, field.key)"
                  @remove="update(null)"
                />
                <MultiRelationField
                  v-else-if="field.type === 'dynamic-multirelation'"
                  :label="field.label"
                  :items="resolvedMultiRelations[field.key] ?? []"
                  @add="
                    orchestrator.openPicker(
                      field.key,
                      getTargetContentTypeIds(field),
                      props.depth
                    )
                  "
                  @edit="
                    (idx) => {
                      const refs = getMultiRelationValue(value);
                      const r = refs[idx];
                      if (r) {
                        orchestrator.openPane(
                          r.contentTypeId,
                          r.entryId,
                          field.key,
                          props.depth
                        );
                      }
                    }
                  "
                  @remove="
                    (idx) => {
                      const refs = [...getMultiRelationValue(value)];
                      refs.splice(idx, 1);
                      update(refs);
                    }
                  "
                  @reorder="(items) => update(items)"
                />
              </template>
            </ContentEditor>
          </div>
          <EntrySidebar
            class="w-80 shrink-0 border-l border-gray-200 dark:border-gray-700 overflow-y-auto"
            :status="status"
            :is-dirty="isDirty"
            :saving="isSaving"
            :has-published-version="hasPublishedVersion"
            :has-archived-version="hasArchivedVersion"
            :is-new="isNew"
            :entry-id="props.entryId ?? null"
            :content-type-name="contentType?.name ?? ''"
            :content-type-id="resolvedContentTypeId"
            :created-at="createdAt"
            :updated-at="updatedAt"
            :published-at="publishedAt"
            :on-save-draft="handleSaveDraft"
            :on-publish="handlePublish"
            :on-discard-changes="handleDiscardChanges"
            :on-delete="props.entryId ? handleDelete : undefined"
            :on-action="props.entryId ? handleAction : undefined"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-pane-enter-active,
.slide-pane-leave-active {
  transition: transform 0.3s ease;
}
.slide-pane-enter-from,
.slide-pane-leave-to {
  transform: translateX(100%);
}
</style>
