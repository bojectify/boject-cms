<script setup lang="ts">
import draggable from 'vuedraggable';

const toast = useToast();
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const name = ref('');
const identifier = ref('');
const identifierTouched = ref(false);
const description = ref('');

function toPascalCase(str: string): string {
  return str
    .trim()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

watch(name, (val) => {
  if (!identifierTouched.value) {
    identifier.value = toPascalCase(val);
  }
});

interface FieldDraft {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}

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

const fields = ref<FieldDraft[]>([
  {
    identifier: 'title',
    name: 'Title',
    type: 'ENTRY_TITLE',
    required: true,
    options: null,
  },
  {
    identifier: 'slug',
    name: 'Slug',
    type: 'SLUG',
    required: false,
    options: null,
  },
]);

// Modal state
const fieldModalOpen = ref(false);
const fieldModalMode = ref<'add' | 'edit'>('add');
const fieldModalField = ref<{
  id?: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
} | null>(null);
const editingIndex = ref<number | null>(null);

function openAddFieldModal() {
  fieldModalMode.value = 'add';
  fieldModalField.value = null;
  editingIndex.value = null;
  fieldModalOpen.value = true;
}

function openEditFieldModal(index: number) {
  const f = fields.value[index];
  if (!f) return;
  fieldModalMode.value = 'edit';
  fieldModalField.value = {
    identifier: f.identifier,
    name: f.name,
    type: f.type,
    required: f.required,
    options: f.options,
  };
  editingIndex.value = index;
  fieldModalOpen.value = true;
}

function handleFieldSave(data: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}) {
  if (fieldModalMode.value === 'add') {
    fields.value.push({
      identifier: data.identifier,
      name: data.name,
      type: data.type,
      required: data.required,
      options: data.options ?? null,
    });
    toast.add({
      title: 'Added',
      description: 'Field added.',
      color: 'success',
    });
  } else if (editingIndex.value !== null) {
    fields.value[editingIndex.value] = {
      identifier: data.identifier,
      name: data.name,
      type: data.type,
      required: data.required,
      options: data.options ?? null,
    };
    toast.add({
      title: 'Updated',
      description: 'Field updated.',
      color: 'success',
    });
  }
  fieldModalOpen.value = false;
}

function handleFieldDelete() {
  if (editingIndex.value !== null) {
    fields.value.splice(editingIndex.value, 1);
    toast.add({
      title: 'Removed',
      description: 'Field removed.',
      color: 'success',
    });
  }
  fieldModalOpen.value = false;
}

function fieldMenuItems(index: number) {
  return [
    [
      {
        label: 'Edit',
        icon: 'i-lucide-pencil',
        onSelect: () => openEditFieldModal(index),
      },
    ],
  ];
}

const hasEntryTitle = computed(() =>
  fields.value.some((f) => f.type === 'ENTRY_TITLE')
);

async function handleSave() {
  if (!name.value.trim()) {
    saveError.value = 'Name is required';
    return;
  }
  if (!hasEntryTitle.value) {
    saveError.value = 'At least one ENTRY_TITLE field is required';
    return;
  }

  isSaving.value = true;
  saveError.value = null;
  try {
    const payload = {
      name: name.value.trim(),
      identifier: identifier.value.trim(),
      description: description.value.trim() || null,
      fields: fields.value.map((f, idx) => ({
        identifier: f.identifier,
        name: f.name,
        type: f.type,
        required: f.required,
        order: idx,
        ...(f.options ? { options: f.options } : {}),
      })),
    };

    const created = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      body: payload,
    });

    toast.add({
      title: 'Created',
      description: 'Content type created successfully.',
      color: 'success',
    });

    await navigateTo(`/content-types/${created.id}`);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to create content type.';
    saveError.value = message;
    toast.add({ title: 'Error', description: message, color: 'error' });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">New Content Type</h1>
      <UButton :loading="isSaving" icon="i-lucide-save" @click="handleSave">
        Save
      </UButton>
    </div>

    <UAlert
      v-if="saveError"
      color="error"
      icon="i-lucide-alert-circle"
      :title="saveError"
      class="mb-6"
    />

    <div class="space-y-6 max-w-2xl">
      <UFormField label="Name" required size="xl">
        <UInput v-model="name" placeholder="e.g. Blog Post" class="w-full" />
      </UFormField>

      <UFormField
        label="Identifier"
        required
        size="xl"
        hint="PascalCase, used in APIs"
      >
        <UInput
          v-model="identifier"
          placeholder="e.g. BlogPost"
          class="w-full"
          @input="identifierTouched = true"
        />
      </UFormField>

      <UFormField label="Description" size="xl">
        <UTextarea
          v-model="description"
          placeholder="Optional description..."
          :rows="3"
          class="w-full"
        />
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
        v-model="fields"
        item-key="identifier"
        handle=".drag-handle"
        animation="150"
        class="space-y-3"
      >
        <template #item="{ element: field, index: idx }">
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
              <UDropdownMenu :items="fieldMenuItems(idx)">
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
    </div>

    <FieldModal
      :open="fieldModalOpen"
      :mode="fieldModalMode"
      :field="fieldModalField"
      :field-type-options="fieldTypeOptions"
      :entry-count="0"
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
      </template>
    </FieldModal>
  </div>
</template>
