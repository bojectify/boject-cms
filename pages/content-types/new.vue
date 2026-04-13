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
  choices: string;
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
    choices: '',
  },
  {
    identifier: 'slug',
    name: 'Slug',
    type: 'SLUG',
    required: false,
    choices: '',
  },
]);

const newField = reactive<FieldDraft>({
  identifier: '',
  name: '',
  type: 'TEXT',
  required: false,
  choices: '',
});

function addField() {
  if (!newField.identifier || !newField.name) return;
  fields.value.push({ ...newField });
  newField.identifier = '';
  newField.name = '';
  newField.type = 'TEXT';
  newField.required = false;
  newField.choices = '';
}

function removeField(index: number) {
  fields.value.splice(index, 1);
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
        ...(f.type === 'SELECT' && f.choices.trim()
          ? {
              options: {
                choices: f.choices
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              },
            }
          : {}),
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

      <USeparator label="Fields" />

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
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="removeField(idx)"
              />
            </div>
            <p
              v-if="field.type === 'SELECT' && field.choices"
              class="text-sm text-muted mt-1 pl-7"
            >
              Choices: {{ field.choices }}
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
