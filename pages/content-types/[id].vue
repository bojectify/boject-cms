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
} = await useFetch<{
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
    await $fetch(`/api/content-types/${id}`, {
      method: 'PUT',
      body: {
        name: formName.value.trim(),
        identifier: formIdentifier.value.trim(),
        description: formDescription.value.trim() || null,
      },
    });
    await refresh();
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
];

const newField = reactive({
  identifier: '',
  name: '',
  type: 'TEXT',
  required: false,
  choices: '',
});

async function addField() {
  if (!newField.identifier || !newField.name) return;
  try {
    await $fetch(`/api/content-types/${id}/fields`, {
      method: 'POST',
      body: {
        identifier: newField.identifier,
        name: newField.name,
        type: newField.type,
        required: newField.required,
        ...(newField.type === 'SELECT' && newField.choices.trim()
          ? {
              options: {
                choices: newField.choices
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              },
            }
          : {}),
      },
    });
    newField.identifier = '';
    newField.name = '';
    newField.type = 'TEXT';
    newField.required = false;
    newField.choices = '';
    await refresh();
    toast.add({
      title: 'Added',
      description: 'Field added successfully.',
      color: 'success',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function removeField(fieldId: string) {
  try {
    await fetch(`/api/content-types/${id}/fields/${fieldId}`, {
      method: 'DELETE',
    });
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

function formatChoices(options: unknown): string {
  if (!options || typeof options !== 'object') return '';
  const opts = options as { choices?: string[] };
  return opts.choices?.join(', ') ?? '';
}
</script>

<template>
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
      <UIcon name="i-lucide-loader-2" class="animate-spin size-8 text-muted" />
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

      <USeparator label="Fields" />

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
              </div>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="removeField(field.id)"
              />
            </div>
            <p
              v-if="field.type === 'SELECT' && formatChoices(field.options)"
              class="text-sm text-muted mt-1 pl-7"
            >
              Choices: {{ formatChoices(field.options) }}
            </p>
          </div>
        </template>
      </draggable>

      <USeparator label="Add Field" />

      <div class="space-y-3 border rounded-lg p-4">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Identifier" size="xl" hint="camelCase">
            <UInput
              v-model="newField.identifier"
              placeholder="e.g. subtitle"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Name" size="xl">
            <UInput
              v-model="newField.name"
              placeholder="e.g. Subtitle"
              class="w-full"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Type" size="xl">
            <USelect
              v-model="newField.type"
              :items="fieldTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label=" " size="xl">
            <USwitch v-model="newField.required" label="Required" />
          </UFormField>
        </div>
        <UFormField
          v-if="newField.type === 'SELECT'"
          label="Choices (comma-separated)"
          size="xl"
        >
          <UInput
            v-model="newField.choices"
            placeholder="e.g. option_a, option_b, option_c"
            class="w-full"
          />
        </UFormField>
        <UButton
          icon="i-lucide-plus"
          :disabled="!newField.identifier || !newField.name"
          @click="addField"
        >
          Add Field
        </UButton>
      </div>
    </div>
  </div>
</template>
