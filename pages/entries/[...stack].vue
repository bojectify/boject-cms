<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';
import { parseStack, stackHref, type PaneSegment } from '~/utils/paneStack';

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
  status,
  hasPublishedVersion,
  publishedAt,
  createdAt,
  updatedAt,
  isDirty,
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
  if (newId && rootIsNew.value) {
    await router.replace(`/entries/${newId}`);
  }
}

async function handlePublish() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await publish();
  if (newId && rootIsNew.value) {
    await router.replace(`/entries/${newId}`);
  }
}

async function handleDiscardChanges() {
  await discardChanges();
}

// ---- Dirty guards ----
const paneEls = useTemplateRef<Array<{ isDirty: boolean } | null>>('paneEls');

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

// ---- Template helpers ----
type RelationRef = {
  contentTypeId: string;
  entryId: string;
};

function getRelationValue(value: unknown): RelationRef | null {
  return (value as RelationRef | null) ?? null;
}

function getMultiRelationValue(value: unknown): RelationRef[] {
  return (value as RelationRef[]) ?? [];
}

function getTargetContentTypeIds(field: FieldConfig): string[] {
  if (
    field.type === 'dynamic-relation' ||
    field.type === 'dynamic-multirelation'
  ) {
    return field.targetContentTypeIds;
  }
  return [];
}

function handleRelationEdit(value: unknown, fieldKey: string) {
  const ref = value as RelationRef | null;
  if (ref) {
    openPane(ref.contentTypeId, ref.entryId, fieldKey);
  }
}

// ---- Relation resolver ----
const { resolveRef, resolveRefs, updateCache } = useRelationResolver();

const resolvedRelations = reactive<
  Record<string, { entryTitle: string; contentTypeName: string }>
>({});
const resolvedMultiRelations = reactive<
  Record<
    string,
    Array<{
      contentTypeId: string;
      entryId: string;
      entryTitle: string;
      contentTypeName: string;
    }>
  >
>({});

watch(
  () => ({ ...formState }),
  async () => {
    for (const field of editorFields.value) {
      if (field.type === 'dynamic-relation') {
        const val = formState[field.key] as {
          contentTypeId: string;
          entryId: string;
        } | null;
        if (val?.contentTypeId && val?.entryId) {
          const resolved = await resolveRef(val);
          resolvedRelations[field.key] = {
            entryTitle: resolved.entryTitle,
            contentTypeName: resolved.contentTypeName,
          };
        } else {
          delete resolvedRelations[field.key];
        }
      }
      if (field.type === 'dynamic-multirelation') {
        const val = formState[field.key] as Array<{
          contentTypeId: string;
          entryId: string;
        }> | null;
        if (val && val.length > 0) {
          resolvedMultiRelations[field.key] = await resolveRefs(val);
        } else {
          resolvedMultiRelations[field.key] = [];
        }
      }
    }
  },
  { immediate: true }
);

// ---- Picker modal state ----
const pickerOpen = ref(false);
const pickerFieldKey = ref('');
const pickerTargetTypeIds = ref<string[]>([]);

function openPicker(fieldKey: string, targetContentTypeIds: string[]) {
  pickerFieldKey.value = fieldKey;
  pickerTargetTypeIds.value = targetContentTypeIds;
  pickerOpen.value = true;
}

function handlePickerSelect(data: {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
}) {
  const fieldKey = pickerFieldKey.value;
  const field = editorFields.value.find((f) => f.key === fieldKey);
  if (!field) return;
  if (field.type === 'dynamic-relation') {
    formState[fieldKey] = {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    };
  } else if (field.type === 'dynamic-multirelation') {
    const current =
      (formState[fieldKey] as Array<{
        contentTypeId: string;
        entryId: string;
      }>) ?? [];
    formState[fieldKey] = [
      ...current,
      { contentTypeId: data.contentTypeId, entryId: data.entryId },
    ];
  }
  pickerOpen.value = false;
}

async function handlePickerCreate(ctId: string) {
  const fieldKey = pickerFieldKey.value;
  pickerOpen.value = false;
  await nextTick();
  openPane(ctId, null, fieldKey);
}

// ---- Pane navigation ----
function openPane(
  targetContentTypeId: string,
  targetEntryId: string | null,
  fieldKey: string
) {
  const newSegment: PaneSegment = targetEntryId
    ? { kind: 'entry', entryId: targetEntryId }
    : { kind: 'new', contentTypeId: targetContentTypeId };
  const newStack = [...parsedStack.value, newSegment];
  router.push({ path: stackHref(newStack), query: { pf: fieldKey } });
}

function closePane(idx: number) {
  // idx is 0-based within paneSegments. Keep root + first `idx` panes.
  const newStack = parsedStack.value.slice(0, idx + 1);
  router.push(stackHref(newStack));
}

function applyFieldUpdate(
  fieldKey: string,
  data: { contentTypeId: string; entryId: string }
) {
  const field = editorFields.value.find((f) => f.key === fieldKey);
  if (!field) return;
  if (field.type === 'dynamic-relation') {
    formState[fieldKey] = {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    };
  } else if (field.type === 'dynamic-multirelation') {
    const current =
      (formState[fieldKey] as Array<{
        contentTypeId: string;
        entryId: string;
      }>) ?? [];
    if (!current.some((r) => r.entryId === data.entryId)) {
      formState[fieldKey] = [
        ...current,
        { contentTypeId: data.contentTypeId, entryId: data.entryId },
      ];
    }
  }
}

function handlePaneSaved(
  paneIdx: number,
  data: { contentTypeId: string; entryId: string; entryTitle: string }
) {
  const pf = route.query.pf as string | undefined;
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);

  // Apply side-effect to root's formState when saving the first pane
  // (idx=0) with ?pf set. Deeper nesting is out of scope for MVP.
  if (pf && paneIdx === 0) {
    applyFieldUpdate(pf, data);
  }

  // Keep the pane open. If the pane was a `new:<ctid>` sentinel, replace
  // it with the saved entry id so subsequent saves PUT rather than POST.
  // Also clears ?pf from the URL since the side-effect has been applied.
  const fullStackIdx = paneIdx + 1; // paneSegments[paneIdx] is parsedStack[paneIdx + 1]
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
              @add="openPicker(field.key, getTargetContentTypeIds(field))"
              @edit="handleRelationEdit(value, field.key)"
              @remove="update(null)"
            />
            <MultiRelationField
              v-else-if="field.type === 'dynamic-multirelation'"
              :label="field.label"
              :items="resolvedMultiRelations[field.key] ?? []"
              @add="openPicker(field.key, getTargetContentTypeIds(field))"
              @edit="
                (idx: number) => {
                  const refs = getMultiRelationValue(value);
                  const ref = refs[idx];
                  if (ref) {
                    openPane(ref.contentTypeId, ref.entryId, field.key);
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
      :content-type-id="pane.kind === 'new' ? pane.contentTypeId : undefined"
      :entry-id="pane.kind === 'entry' ? pane.entryId : null"
      @close="closePane(idx)"
      @saved="(data) => handlePaneSaved(idx, data)"
    />
  </div>
</template>
