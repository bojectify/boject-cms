<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const contentTypeId = route.params.id as string;
const entryId = route.params.entryId as string;

// Fetch content type to get field definitions
const { data: contentType } = await useAuthedFetch<{
  id: string;
  name: string;
  fields: Array<{
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
  }>;
}>(`/api/content-types/${contentTypeId}`);

const hasSlugField = computed(
  () => contentType.value?.fields.some((f) => f.type === 'SLUG') ?? false
);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.identifier ?? 'title';
});

// Map ContentTypeField definitions to FieldConfig for ContentEditor
// Filter out SLUG fields (handled by ContentEditor's built-in slug section)
const editorFields = computed<FieldConfig[]>(() => {
  if (!contentType.value) return [];
  return contentType.value.fields
    .filter((f) => f.type !== 'SLUG')
    .map((f) => mapFieldToConfig(f));
});

const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEntryEditor(contentTypeId, entryId);

const pageTitle = computed(() => {
  const titleVal = formState[entryTitleFieldIdentifier.value];
  if (typeof titleVal === 'string' && titleVal) return titleVal;
  return contentType.value?.name ?? 'Entry';
});

async function handleSave() {
  await save();
}

// Template helpers to avoid `as` casts in templates
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

// Relation field state
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

// Resolve references when formState changes
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

// Picker modal state
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

// Editor pane state
const paneOpen = ref(false);
const paneContentTypeId = ref('');
const paneEntryId = ref<string | null>(null);
const paneFieldKey = ref('');

function openPane(
  targetContentTypeId: string,
  targetEntryId: string | null,
  fieldKey: string
) {
  paneContentTypeId.value = targetContentTypeId;
  paneEntryId.value = targetEntryId;
  paneFieldKey.value = fieldKey;
  paneOpen.value = true;
}

function handlePickerCreate(contentTypeId: string) {
  pickerOpen.value = false;
  openPane(contentTypeId, null, pickerFieldKey.value);
}

function handlePaneSaved(data: {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
}) {
  const fieldKey = paneFieldKey.value;
  const field = editorFields.value.find((f) => f.key === fieldKey);
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);
  if (field?.type === 'dynamic-relation') {
    formState[fieldKey] = {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    };
  } else if (field?.type === 'dynamic-multirelation') {
    const current =
      (formState[fieldKey] as Array<{
        contentTypeId: string;
        entryId: string;
      }>) ?? [];
    if (!current.some((r) => r.entryId === data.entryId)) {
      formState[fieldKey] = [
        ...current,
        {
          contentTypeId: data.contentTypeId,
          entryId: data.entryId,
        },
      ];
    }
  }
  paneOpen.value = false;
}
</script>

<template>
  <div class="relative h-full overflow-hidden">
    <div class="h-full overflow-y-auto">
      <!-- Nav header -->
      <div
        class="flex items-center gap-4 px-6 py-3 border-b border-gray-200 dark:border-gray-700"
      >
        <UButton
          variant="ghost"
          icon="i-lucide-arrow-left"
          size="sm"
          :to="`/content-types/${contentTypeId}/entries`"
        />
        <USeparator orientation="vertical" class="h-4" />
        <NuxtLink
          :to="`/content-types/${contentTypeId}`"
          class="flex items-center gap-1.5 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {{ contentType?.name ?? 'Content Type' }}
          <UIcon name="i-lucide-external-link" class="size-3" />
        </NuxtLink>
      </div>

      <ContentEditor
        v-model:state="formState"
        :title="pageTitle"
        :fields="editorFields"
        :loading="loadingStatus === 'pending'"
        :saving="isSaving"
        :error="saveError"
        :show-slug="hasSlugField"
        :on-save="handleSave"
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

    <EntryPickerModal
      :open="pickerOpen"
      :target-content-type-ids="pickerTargetTypeIds"
      @select="handlePickerSelect"
      @create="handlePickerCreate"
      @close="pickerOpen = false"
    />

    <EntryEditorPane
      :open="paneOpen"
      :content-type-id="paneContentTypeId"
      :entry-id="paneEntryId"
      @close="paneOpen = false"
      @saved="handlePaneSaved"
    />
  </div>
</template>
