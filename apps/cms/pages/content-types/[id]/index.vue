<script setup lang="ts">
import draggable from 'vuedraggable';

const route = useRoute();
const id = route.params.id as string;
const toast = useToast();

// Content type data
const {
  data: contentType,
  status: loadingStatus,
  refresh,
} = await useAuthedFetch<{
  id: string;
  name: string;
  identifier: string;
  description: string | null;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    unique: boolean;
    order: number;
    options: unknown;
  }>;
  _count: { entries: number };
}>(`/api/content-types/${id}`);

const draggableFields = computed({
  get: () => contentType.value?.fields ?? [],
  set: (val) => {
    if (contentType.value) {
      contentType.value.fields = val;
    }
  },
});

const formName = ref('');
const formIdentifier = ref('');
const formDescription = ref('');
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(
  contentType,
  (val) => {
    if (val) {
      formName.value = val.name;
      formIdentifier.value = val.identifier;
      formDescription.value = val.description ?? '';
    }
  },
  { immediate: true }
);

async function handleSave() {
  if (!formName.value.trim()) {
    saveError.value = 'Name is required';
    return;
  }
  isSaving.value = true;
  saveError.value = null;
  try {
    await fetch(`/api/content-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName.value.trim(),
        identifier: formIdentifier.value.trim(),
        description: formDescription.value.trim() || null,
      }),
    });
    await refresh();
    await refreshNuxtData('sidebar-content-types');
    toast.add({
      title: 'Saved',
      description: 'Content type updated successfully.',
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

// Field management
const fieldTypeOptions = [
  { label: 'Entry Title', value: 'ENTRY_TITLE' },
  { label: 'Slug', value: 'SLUG' },
  { label: 'Text', value: 'TEXT' },
  { label: 'Textarea', value: 'TEXTAREA' },
  { label: 'Number', value: 'NUMBER' },
  { label: 'Boolean', value: 'BOOLEAN' },
  { label: 'Date/Time', value: 'DATETIME' },
  { label: 'Select', value: 'SELECT' },
  { label: 'Rich Text', value: 'RICHTEXT' },
  { label: 'Relation', value: 'RELATION' },
  { label: 'Multi Relation', value: 'MULTIRELATION' },
  { label: 'Image', value: 'IMAGE' },
];

// Content type options for relation field target picker
const { data: contentTypeOptions } = useAuthedFetch<
  { label: string; value: string }[]
>('/api/content-types/options');

// Modal state
const fieldModalOpen = ref(false);
const fieldModalMode = ref<'add' | 'edit'>('add');
const fieldModalField = ref<{
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
} | null>(null);
const conflictAlert = ref<{
  message: string;
  conflicts: Array<{ value: unknown; entryIds: string[] }>;
} | null>(null);

function openAddFieldModal() {
  fieldModalMode.value = 'add';
  fieldModalField.value = null;
  conflictAlert.value = null;
  fieldModalOpen.value = true;
}

function openEditFieldModal(field: {
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}) {
  fieldModalMode.value = 'edit';
  fieldModalField.value = field;
  conflictAlert.value = null;
  fieldModalOpen.value = true;
}

async function handleFieldSave(data: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}) {
  conflictAlert.value = null;
  try {
    if (fieldModalMode.value === 'add') {
      await $fetch(`/api/content-types/${id}/fields`, {
        method: 'POST',
        body: {
          identifier: data.identifier,
          name: data.name,
          type: data.type,
          required: data.required,
          unique: data.unique,
          ...(data.options ? { options: data.options } : {}),
        },
      });
      toast.add({
        title: 'Added',
        description: 'Field added successfully.',
        color: 'success',
      });
    } else {
      await $fetch(
        `/api/content-types/${id}/fields/${fieldModalField.value!.id}`,
        {
          method: 'PUT',
          body: {
            name: data.name,
            required: data.required,
            unique: data.unique,
            ...(data.options ? { options: data.options } : {}),
          },
        }
      );
      toast.add({
        title: 'Saved',
        description: 'Field updated successfully.',
        color: 'success',
      });
    }
    fieldModalOpen.value = false;
    await refresh();
  } catch (err: unknown) {
    const conflict = parseUniqueConflict(err);
    if (conflict?.kind === 'field') {
      conflictAlert.value = {
        message: conflict.message,
        conflicts: conflict.conflicts,
      };
      return; // Keep the modal open so the user can see the alert
    }
    const message =
      err instanceof Error ? err.message : 'Failed to save field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function handleFieldDelete(fieldId: string) {
  try {
    await fetch(`/api/content-types/${id}/fields/${fieldId}`, {
      method: 'DELETE',
    });
    fieldModalOpen.value = false;
    await refresh();
    toast.add({
      title: 'Removed',
      description: 'Field removed.',
      color: 'success',
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to remove field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

function fieldMenuItems(field: {
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}) {
  return [
    [
      {
        label: 'Edit',
        icon: 'i-lucide-pencil',
        onSelect: () => openEditFieldModal(field),
      },
    ],
  ];
}

const isDeleting = ref(false);

async function handleDeleteContentType() {
  const typeName = contentType.value?.name ?? 'this content type';
  if (!window.confirm(`Delete ${typeName}? This cannot be undone.`)) {
    return;
  }
  isDeleting.value = true;
  try {
    const res = await fetch(`/api/content-types/${id}`, {
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
      description: `${typeName} was deleted.`,
      color: 'success',
    });
    await refreshNuxtData('sidebar-content-types');
    await navigateTo('/content-types');
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete content type.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  } finally {
    isDeleting.value = false;
  }
}

async function onFieldReorder() {
  const currentFields = contentType.value?.fields ?? [];
  const reordered = currentFields.map((field, i) => ({
    id: field.id,
    order: i,
  }));

  try {
    await $fetch(`/api/content-types/${id}/fields/reorder`, {
      method: 'PUT',
      body: { fields: reordered },
    });
    await refresh();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to reorder fields.';
    toast.add({ title: 'Error', description: message, color: 'error' });
    await refresh();
  }
}
</script>

<template>
  <div>
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          {{ contentType?.name ?? 'Content Type' }}
        </h1>
        <div class="flex gap-2">
          <UButton
            :to="`/content-types/${id}/entries`"
            variant="outline"
            icon="i-lucide-list"
          >
            View Entries
            <UBadge
              v-if="contentType?._count.entries"
              size="sm"
              variant="subtle"
              class="ml-1"
            >
              {{ contentType._count.entries }}
            </UBadge>
          </UButton>
          <UButton :loading="isSaving" icon="i-lucide-save" @click="handleSave">
            Save
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="saveError"
        color="error"
        icon="i-lucide-alert-circle"
        :title="saveError"
        class="mb-6"
      />

      <div v-if="loadingStatus === 'pending'" class="flex justify-center py-12">
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin size-8 text-muted"
        />
      </div>

      <div v-else class="space-y-6 max-w-2xl">
        <UFormField label="Name" required size="xl">
          <UInput v-model="formName" class="w-full" />
        </UFormField>

        <UFormField
          label="Identifier"
          required
          size="xl"
          hint="PascalCase, used in APIs"
        >
          <UInput v-model="formIdentifier" class="w-full" />
        </UFormField>

        <UFormField label="Description" size="xl">
          <UTextarea v-model="formDescription" :rows="3" class="w-full" />
        </UFormField>

        <div class="flex items-center gap-4">
          <USeparator class="flex-1" />
          <span class="text-sm font-medium text-muted shrink-0">Fields</span>
          <UButton
            size="xs"
            variant="outline"
            icon="i-lucide-plus"
            @click="openAddFieldModal"
          >
            Add Field
          </UButton>
          <USeparator class="flex-1" />
        </div>

        <draggable
          v-model="draggableFields"
          item-key="id"
          handle=".drag-handle"
          animation="150"
          class="space-y-3"
          @end="onFieldReorder"
        >
          <template #item="{ element: field }">
            <div class="border rounded-lg p-3">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-grip-vertical"
                  class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <span class="font-medium">{{ field.name }}</span>
                  <span class="text-sm text-muted ml-2"
                    >({{ field.identifier }})</span
                  >
                  <UBadge class="ml-2" size="sm" variant="subtle">
                    {{ field.type }}
                  </UBadge>
                  <UBadge
                    v-if="field.required"
                    color="warning"
                    size="sm"
                    variant="subtle"
                    class="ml-1"
                  >
                    Required
                  </UBadge>
                  <UBadge
                    v-if="field.unique"
                    color="info"
                    size="sm"
                    variant="subtle"
                    class="ml-1"
                  >
                    Unique
                  </UBadge>
                </div>
                <UDropdownMenu :items="fieldMenuItems(field)">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    icon="i-lucide-ellipsis"
                  />
                </UDropdownMenu>
              </div>
            </div>
          </template>
        </draggable>

        <div class="pt-8">
          <USeparator color="error" />
          <div class="flex items-center justify-between pt-4">
            <div>
              <p class="text-sm font-medium text-red-700 dark:text-red-400">
                Delete this content type
              </p>
              <p class="text-xs text-muted">
                Only content types with no entries can be deleted.
              </p>
            </div>
            <UButton
              size="sm"
              variant="outline"
              color="error"
              icon="i-lucide-trash-2"
              :loading="isDeleting"
              @click="handleDeleteContentType"
            >
              Delete
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <FieldModal
      :open="fieldModalOpen"
      :mode="fieldModalMode"
      :field="fieldModalField"
      :field-type-options="fieldTypeOptions"
      :entry-count="contentType?._count.entries"
      :conflict-alert="conflictAlert"
      @close="fieldModalOpen = false"
      @save="handleFieldSave"
      @delete="handleFieldDelete"
    >
      <template #type-options="{ type, options, updateOptions }">
        <UFormField v-if="type === 'SELECT'" label="Choices (comma-separated)">
          <UInput
            :model-value="
              options && typeof options === 'object' && 'choices' in options
                ? (options as { choices: string[] }).choices.join(', ')
                : ''
            "
            placeholder="e.g. option_a, option_b, option_c"
            class="w-full"
            @update:model-value="
              (val: string) =>
                updateOptions({
                  choices: val
                    .split(',')
                    .map((c: string) => c.trim())
                    .filter(Boolean),
                })
            "
          />
        </UFormField>
        <UFormField
          v-else-if="type === 'RELATION' || type === 'MULTIRELATION'"
          label="Target Content Types"
          required
        >
          <div class="space-y-2">
            <div
              v-if="
                options &&
                typeof options === 'object' &&
                'targetContentTypeIds' in options &&
                ((options as { targetContentTypeIds: string[] })
                  .targetContentTypeIds?.length ?? 0) > 0
              "
              class="flex flex-wrap gap-2"
            >
              <UBadge
                v-for="targetId in (
                  options as { targetContentTypeIds: string[] }
                ).targetContentTypeIds"
                :key="targetId"
                size="md"
                variant="subtle"
                color="info"
                class="cursor-pointer"
                @click="
                  updateOptions({
                    targetContentTypeIds: (
                      options as { targetContentTypeIds: string[] }
                    ).targetContentTypeIds.filter(
                      (id: string) => id !== targetId
                    ),
                  })
                "
              >
                {{
                  contentTypeOptions?.find((o) => o.value === targetId)
                    ?.label ?? targetId
                }}
                <UIcon name="i-lucide-x" class="size-3 ml-1" />
              </UBadge>
            </div>
            <USelect
              :model-value="''"
              :items="
                (contentTypeOptions ?? []).filter(
                  (o) =>
                    !(
                      options &&
                      typeof options === 'object' &&
                      'targetContentTypeIds' in options &&
                      (
                        options as { targetContentTypeIds: string[] }
                      ).targetContentTypeIds.includes(o.value)
                    )
                )
              "
              value-key="value"
              placeholder="Add content type..."
              class="w-full"
              @update:model-value="
                (val: string) => {
                  if (!val) return;
                  const current =
                    options &&
                    typeof options === 'object' &&
                    'targetContentTypeIds' in options
                      ? (options as { targetContentTypeIds: string[] })
                          .targetContentTypeIds
                      : [];
                  updateOptions({
                    targetContentTypeIds: [...current, val],
                  });
                }
              "
            />
          </div>
        </UFormField>
      </template>
    </FieldModal>
  </div>
</template>
