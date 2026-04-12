<script setup lang="ts">
const toast = useToast();
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const name = ref('');
const description = ref('');

interface FieldDraft {
  name: string;
  label: string;
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
];

const fields = ref<FieldDraft[]>([
  {
    name: 'title',
    label: 'Title',
    type: 'ENTRY_TITLE',
    required: true,
    choices: '',
  },
  { name: 'slug', label: 'Slug', type: 'SLUG', required: false, choices: '' },
]);

const newField = reactive<FieldDraft>({
  name: '',
  label: '',
  type: 'TEXT',
  required: false,
  choices: '',
});

function addField() {
  if (!newField.name || !newField.label) return;
  fields.value.push({ ...newField });
  newField.name = '';
  newField.label = '';
  newField.type = 'TEXT';
  newField.required = false;
  newField.choices = '';
}

function removeField(index: number) {
  fields.value.splice(index, 1);
}

function moveField(index: number, direction: 'up' | 'down') {
  const swapIdx = direction === 'up' ? index - 1 : index + 1;
  if (swapIdx < 0 || swapIdx >= fields.value.length) return;
  const temp = fields.value[index]!;
  fields.value[index] = fields.value[swapIdx]!;
  fields.value[swapIdx] = temp;
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
      description: description.value.trim() || null,
      fields: fields.value.map((f, idx) => ({
        name: f.name,
        label: f.label,
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

      <UFormField label="Description" size="xl">
        <UTextarea
          v-model="description"
          placeholder="Optional description..."
          :rows="3"
          class="w-full"
        />
      </UFormField>

      <USeparator label="Fields" />

      <div class="space-y-3">
        <div
          v-for="(field, idx) in fields"
          :key="idx"
          class="border rounded-lg p-3"
        >
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <span class="font-medium">{{ field.label }}</span>
              <span class="text-sm text-muted ml-2">({{ field.name }})</span>
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
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-up"
                :disabled="idx === 0"
                @click="moveField(idx, 'up')"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-down"
                :disabled="idx === fields.length - 1"
                @click="moveField(idx, 'down')"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="removeField(idx)"
              />
            </div>
          </div>
          <p
            v-if="field.type === 'SELECT' && field.choices"
            class="text-sm text-muted mt-1"
          >
            Choices: {{ field.choices }}
          </p>
        </div>
      </div>

      <USeparator label="Add Field" />

      <div class="space-y-3 border rounded-lg p-4">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Machine Name" size="xl">
            <UInput
              v-model="newField.name"
              placeholder="e.g. subtitle"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Label" size="xl">
            <UInput
              v-model="newField.label"
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
          :disabled="!newField.name || !newField.label"
          @click="addField"
        >
          Add Field
        </UButton>
      </div>
    </div>
  </div>
</template>
