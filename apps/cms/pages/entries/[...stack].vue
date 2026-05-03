<script setup lang="ts">
import { provide, ref } from 'vue';
import type { FieldConfig } from '~/types/contentEditor';
import {
  paneOrchestratorKey,
  type PaneOrchestrator,
} from '~/composables/paneOrchestrator';
import { parseStack, stackHref, type PaneSegment } from '~/utils/paneStack';
import type { EntryAction } from '~/components/entry-action-menu/entryActionMenu.types';

// Key the page by root entry only, so opening/closing panes and
// replacing a new:<ctid> sentinel with the saved entry id do NOT remount
// the page (default pageKey is route.path, which changes on any stack
// mutation — remounting wipes formState mid-flow).
definePageMeta({
  key: (route) => {
    const raw = route.params.stack;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return `entries:${arr[0] ?? ''}`;
  },
});

const route = useRoute();
const router = useRouter();

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

// ---- Stack parsing ----
const stackSegments = computed<string[]>(() => {
  const raw = route.params.stack;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
});

const parsedStack = computed<PaneSegment[]>(() => {
  try {
    return parseStack(stackSegments.value);
  } catch {
    return [];
  }
});

if (parsedStack.value.length === 0) {
  throw createError({ statusCode: 404, statusMessage: 'Invalid entry path' });
}

// Safe non-null fallback: the createError above guarantees a non-empty
// stack at this point, but TypeScript can't infer that across the
// reactive boundary.
const FALLBACK_ROOT: PaneSegment = { kind: 'new', contentTypeId: '' };

const root = computed<PaneSegment>(() => parsedStack.value[0] ?? FALLBACK_ROOT);
const paneSegments = computed<PaneSegment[]>(() => parsedStack.value.slice(1));

const rootIsNew = computed(() => root.value.kind === 'new');
const rootEntryIdForComposable = computed(() =>
  root.value.kind === 'entry' ? root.value.entryId : 'new'
);
const rootContentTypeIdSentinel = computed(() =>
  root.value.kind === 'new' ? root.value.contentTypeId : ''
);

// ---- Root editor ----
// Declared as a function (not computed) so it can be referenced by
// `useContentEntryEditor` before the derived content-type ref exists —
// the getter is called lazily by the composable.
function resolveRootContentTypeId(): string {
  if (rootIsNew.value) return rootContentTypeIdSentinel.value;
  return contentTypeFromEntry.value?.id ?? '';
}

const {
  isNew,
  entry: rootEntry,
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
  () => resolveRootContentTypeId(),
  () => rootEntryIdForComposable.value
);

// Derive content type from whichever source is active
const contentTypeFromEntry = computed<ContentTypeShape | null>(() => {
  const ct = (rootEntry.value as { contentType?: ContentTypeShape } | null)
    ?.contentType;
  return ct ?? null;
});

// For new entries, fetch /api/content-types/:id. Conditional URL: return
// null to skip the fetch. The `as () => string` cast matches the
// Task 2a approach — Nuxt's type signature doesn't expose the null-skip
// behaviour but it works at runtime.
const { data: contentTypeFromApi } = useAuthedFetch<ContentTypeShape>(
  (() => {
    if (!rootIsNew.value) return null;
    if (!rootContentTypeIdSentinel.value) return null;
    return `/api/content-types/${rootContentTypeIdSentinel.value}`;
  }) as () => string,
  {
    watch: [() => rootIsNew.value, () => rootContentTypeIdSentinel.value],
  }
);

const contentType = computed<ContentTypeShape | null>(() => {
  if (rootIsNew.value) {
    return (contentTypeFromApi.value as ContentTypeShape | null) ?? null;
  }
  return contentTypeFromEntry.value;
});

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

const pageTitle = computed(() => {
  if (rootIsNew.value) return `New ${contentType.value?.name ?? 'Entry'}`;
  const titleVal = formState[entryTitleFieldIdentifier.value];
  if (typeof titleVal === 'string' && titleVal) return titleVal;
  return contentType.value?.name ?? 'Entry';
});

// Auto-generate slug from ENTRY_TITLE field for new entries
watch(
  () => formState[entryTitleFieldIdentifier.value],
  (val) => {
    const slugKey = slugFieldIdentifier.value;
    if (rootIsNew.value && typeof val === 'string' && slugKey) {
      formState[slugKey] = generateSlug(val);
    }
  }
);

const editorRef = useTemplateRef<{ validate: () => Promise<boolean> }>(
  'editorRef'
);

async function handleSaveDraft() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await saveDraft();
  await editorRef.value?.validate();
  if (newId && rootIsNew.value) {
    await router.replace(`/entries/${newId}`);
  }
}

async function handlePublish() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await publish();
  await editorRef.value?.validate();
  if (newId && rootIsNew.value) {
    await router.replace(`/entries/${newId}`);
  }
}

async function handleDiscardChanges() {
  await discardChanges();
}

const toast = useToast();
const isDeleting = ref(false);

async function handleDelete() {
  if (root.value.kind !== 'entry') return;
  const entryId = root.value.entryId;
  const titleVal = formState[entryTitleFieldIdentifier.value];
  const label =
    typeof titleVal === 'string' && titleVal ? titleVal : 'this entry';
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/content-entries/${entryId}`, {
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
    const target = contentType.value?.id
      ? `/content-types/${contentType.value.id}/entries`
      : '/';
    isDeleting.value = true;
    await navigateTo(target);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete entry.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function handleAction(action: EntryAction) {
  if (root.value.kind !== 'entry') return;
  if (action === 'delete') {
    await handleDelete();
    return;
  }
  const entryId = root.value.entryId;
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
    await $fetch(`/api/content-entries/${entryId}/${spec.path}`, {
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

// ---- Dirty guards ----
const paneEls = useTemplateRef<
  Array<{
    isDirty: boolean;
    applyFieldUpdate: (
      fk: string,
      d: { contentTypeId: string; entryId: string }
    ) => void;
    purgeReference: (ref: {
      contentTypeId: string;
      entryId: string;
    }) => boolean;
  } | null>
>('paneEls');

function paneCountFor(stackParam: string | string[] | undefined): number {
  const arr = Array.isArray(stackParam)
    ? stackParam
    : stackParam
      ? [stackParam]
      : [];
  try {
    return Math.max(0, parseStack(arr).length - 1);
  } catch {
    return 0;
  }
}

function anyPaneDirty(fromIdx = 0): boolean {
  const els = paneEls.value ?? [];
  for (let i = fromIdx; i < els.length; i++) {
    if (els[i]?.isDirty) return true;
  }
  return false;
}

if (import.meta.client) {
  const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (isDirty.value || anyPaneDirty()) e.preventDefault();
  };
  onMounted(() => window.addEventListener('beforeunload', beforeUnloadHandler));
  onBeforeUnmount(() =>
    window.removeEventListener('beforeunload', beforeUnloadHandler)
  );
}

// Fires when leaving the catch-all entirely (different root, external nav).
onBeforeRouteLeave(() => {
  if (isDeleting.value) return true;
  if (isDirty.value || anyPaneDirty()) {
    return window.confirm('You have unsaved changes. Leave anyway?');
  }
});

// Fires on same-component navigation (opening / closing panes, URL replaces
// during save). The catch-all page is keyed by root entry, so pane-stack
// changes land here instead of onBeforeRouteLeave.
onBeforeRouteUpdate((to, from) => {
  const fromCount = paneCountFor(from.params.stack);
  const toCount = paneCountFor(to.params.stack);
  if (toCount < fromCount && anyPaneDirty(toCount)) {
    return window.confirm('You have unsaved changes. Close anyway?');
  }
});

// ---- Relation field state (resolvers + applyFieldUpdate) ----
const {
  resolvedRelations,
  resolvedMultiRelations,
  getRelationValue,
  getMultiRelationValue,
  getTargetContentTypeIds,
  applyFieldUpdate: rootApplyFieldUpdate,
  purgeReference: rootPurgeReference,
  updateCache,
} = useRelationFieldState(formState, editorFields);

// Tracks which fieldKey to apply the side-effect to when the pane at a
// given depth next saves. Keyed by target depth (root is 0).
const pendingSideEffect = ref<Record<number, string>>({});

// Track which depth currently owns the open picker.
const pickerFromDepth = ref(0);

// ---- Picker modal state ----
const pickerOpen = ref(false);
const pickerFieldKey = ref('');
const pickerTargetTypeIds = ref<string[]>([]);

// ---- Orchestrator ----
function truncateDeeperSideEffects(newTopDepth: number) {
  const next: Record<number, string> = {};
  for (const [depth, fieldKey] of Object.entries(pendingSideEffect.value)) {
    if (Number(depth) <= newTopDepth) next[Number(depth)] = fieldKey;
  }
  pendingSideEffect.value = next;
}

const orchestrator: PaneOrchestrator = {
  openPicker(fieldKey, targetContentTypeIds, fromDepth) {
    const newStack = parsedStack.value.slice(0, fromDepth + 1);
    if (newStack.length !== parsedStack.value.length) {
      router.push(stackHref(newStack));
    }
    truncateDeeperSideEffects(fromDepth);
    pickerFieldKey.value = fieldKey;
    pickerTargetTypeIds.value = targetContentTypeIds;
    pickerFromDepth.value = fromDepth;
    pickerOpen.value = true;
  },
  openPane(contentTypeId, entryId, fieldKey, fromDepth) {
    const targetDepth = fromDepth + 1;
    pendingSideEffect.value = {
      ...pendingSideEffect.value,
      [targetDepth]: fieldKey,
    };
    const newSegment = entryId
      ? { kind: 'entry' as const, entryId }
      : { kind: 'new' as const, contentTypeId };
    const newStack = parsedStack.value.slice(0, fromDepth + 1);
    newStack.push(newSegment);
    router.push(stackHref(newStack));
  },
};

provide(paneOrchestratorKey, orchestrator);

function handlePickerSelect(data: {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
}) {
  const fieldKey = pickerFieldKey.value;
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);
  if (pickerFromDepth.value === 0) {
    rootApplyFieldUpdate(fieldKey, {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    });
  } else {
    paneEls.value?.[pickerFromDepth.value - 1]?.applyFieldUpdate(fieldKey, {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    });
  }
  pickerOpen.value = false;
}

function handlePickerCreate(ctId: string) {
  const fieldKey = pickerFieldKey.value;
  const fromDepth = pickerFromDepth.value;
  pickerOpen.value = false;
  orchestrator.openPane(ctId, null, fieldKey, fromDepth);
}

function handleRelationEdit(value: unknown, fieldKey: string) {
  const ref = getRelationValue(value);
  if (ref) {
    orchestrator.openPane(ref.contentTypeId, ref.entryId, fieldKey, 0);
  }
}

// ---- Pane navigation ----
function closePane(idx: number) {
  const newStack = parsedStack.value.slice(0, idx + 1);
  truncateDeeperSideEffects(idx);
  router.push(stackHref(newStack));
}

function handlePaneDeleted(
  paneIdx: number,
  data: { contentTypeId: string; entryId: string }
) {
  // Close the deleted pane (and anything stacked on top of it).
  const newStack = parsedStack.value.slice(0, paneIdx + 1);
  truncateDeeperSideEffects(paneIdx);
  router.push(stackHref(newStack));

  // Clear any reference to the deleted entry on the parent surface.
  // paneIdx 0 = first pane, so its parent is the root editor.
  if (paneIdx === 0) {
    rootPurgeReference(data);
  } else {
    paneEls.value?.[paneIdx - 1]?.purgeReference(data);
  }
}

function handlePaneSaved(
  paneIdx: number,
  data: { contentTypeId: string; entryId: string; entryTitle: string }
) {
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);

  // Apply the pending side-effect (if any) to the parent pane at depth
  // paneIdx (which is targetDepth - 1 relative to this save).
  const targetDepth = paneIdx + 1;
  const fieldKey = pendingSideEffect.value[targetDepth];
  if (fieldKey) {
    if (paneIdx === 0) {
      rootApplyFieldUpdate(fieldKey, {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      });
    } else {
      paneEls.value?.[paneIdx - 1]?.applyFieldUpdate(fieldKey, {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      });
    }
    const next: Record<number, string> = {};
    for (const [depth, fk] of Object.entries(pendingSideEffect.value)) {
      if (Number(depth) !== targetDepth) next[Number(depth)] = fk;
    }
    pendingSideEffect.value = next;
  }

  // Rewrite new:<ct> sentinel to the saved entry id (unchanged).
  const fullStackIdx = paneIdx + 1;
  const currentSegment = parsedStack.value[fullStackIdx];
  if (!currentSegment) return;
  const replacedSegment: PaneSegment =
    currentSegment.kind === 'new'
      ? { kind: 'entry', entryId: data.entryId }
      : currentSegment;
  const newStack = [...parsedStack.value];
  newStack[fullStackIdx] = replacedSegment;
  router.replace(stackHref(newStack));
}
</script>

<template>
  <div class="relative flex flex-col h-full overflow-hidden">
    <!-- Nav header -->
    <div
      class="flex items-center gap-4 px-6 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0"
    >
      <UButton
        variant="ghost"
        icon="i-lucide-arrow-left"
        size="sm"
        :to="contentType ? `/content-types/${contentType.id}/entries` : '/'"
      />
      <USeparator orientation="vertical" class="h-4" />
      <NuxtLink
        v-if="contentType"
        :to="`/content-types/${contentType.id}`"
        class="flex items-center gap-1.5 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {{ contentType.name }}
        <UIcon name="i-lucide-external-link" class="size-3" />
      </NuxtLink>
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
              :entry-title="resolvedRelations[field.key]?.entryTitle ?? null"
              :content-type-name="
                resolvedRelations[field.key]?.contentTypeName ?? null
              "
              @add="
                orchestrator.openPicker(
                  field.key,
                  getTargetContentTypeIds(field),
                  0
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
                  0
                )
              "
              @edit="
                (idx: number) => {
                  const refs = getMultiRelationValue(value);
                  const r = refs[idx];
                  if (r) {
                    orchestrator.openPane(
                      r.contentTypeId,
                      r.entryId,
                      field.key,
                      0
                    );
                  }
                }
              "
              @remove="
                (idx: number) => {
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
        :entry-id="root.kind === 'entry' ? root.entryId : null"
        :content-type-name="contentType?.name ?? ''"
        :content-type-id="contentType?.id ?? ''"
        :created-at="createdAt"
        :updated-at="updatedAt"
        :published-at="publishedAt"
        :on-save-draft="handleSaveDraft"
        :on-publish="handlePublish"
        :on-discard-changes="handleDiscardChanges"
        :on-delete="root.kind === 'entry' ? handleDelete : undefined"
        :on-action="root.kind === 'entry' ? handleAction : undefined"
      />
    </div>

    <EntryPickerModal
      :open="pickerOpen"
      :target-content-type-ids="pickerTargetTypeIds"
      @select="handlePickerSelect"
      @create="handlePickerCreate"
      @close="pickerOpen = false"
    />

    <EntryEditorPane
      v-for="(pane, idx) in paneSegments"
      :key="`pane-${idx}`"
      ref="paneEls"
      :open="true"
      :depth="idx + 1"
      :is-topmost="idx === paneSegments.length - 1"
      :content-type-id="pane.kind === 'new' ? pane.contentTypeId : undefined"
      :entry-id="pane.kind === 'entry' ? pane.entryId : null"
      @close="closePane(idx)"
      @saved="(data) => handlePaneSaved(idx, data)"
      @deleted="(data) => handlePaneDeleted(idx, data)"
    />
  </div>
</template>
