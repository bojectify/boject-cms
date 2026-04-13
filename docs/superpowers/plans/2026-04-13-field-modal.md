# Field Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "Add Field" form with a `FieldModal.vue` component that handles both adding and editing fields, with a `#type-options` slot for type-specific configuration.

**Architecture:** Single `FieldModal.vue` component with `mode` prop (`'add' | 'edit'`). Uses Nuxt UI's `UModal` with `#header`, `#body`, `#footer` slots. Exposes a `#type-options` scoped slot for parent pages to inject type-specific configuration UI (e.g. SELECT choices). Both content type pages (`new.vue` and `[id].vue`) use the modal and provide the slot content. Field cards get a three-dot `UDropdownMenu` replacing the trash icon.

**Tech Stack:** Vue 3 (Nuxt UI components: UModal, UDropdownMenu, UBadge, UFormField, UInput, USelect, USwitch, UButton)

---

### Task 1: Fix RICHTEXT in Field Update Endpoint

**Files:**

- Modify: `server/api/content-types/[id]/fields/[fieldId].put.ts:6-15`

- [ ] **Step 1: Add RICHTEXT to VALID_FIELD_TYPES**

In `server/api/content-types/[id]/fields/[fieldId].put.ts`, replace:

```typescript
const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
]);
```

with:

```typescript
const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
  'RICHTEXT',
]);
```

- [ ] **Step 2: Commit**

```bash
git add server/api/content-types/\[id\]/fields/\[fieldId\].put.ts
git commit -m "fix: add RICHTEXT to field update VALID_FIELD_TYPES"
```

---

### Task 2: Create FieldModal Component

**Files:**

- Create: `components/FieldModal.vue`

- [ ] **Step 1: Create the FieldModal component**

Create `components/FieldModal.vue` with the full component. This is a single modal that handles both add and edit modes.

```vue
<script setup lang="ts">
interface FieldData {
  id?: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}

interface FieldFormData {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}

const props = defineProps<{
  open: boolean;
  mode: 'add' | 'edit';
  field: FieldData | null;
  fieldTypeOptions: Array<{ label: string; value: string }>;
  entryCount?: number;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: FieldFormData];
  delete: [fieldId: string];
}>();

const formName = ref('');
const formIdentifier = ref('');
const identifierTouched = ref(false);
const formType = ref('TEXT');
const formRequired = ref(false);
const formOptions = ref<unknown>(null);

function toCamelCase(str: string): string {
  const pascal = str
    .trim()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.field) {
        formName.value = props.field.name;
        formIdentifier.value = props.field.identifier;
        formType.value = props.field.type;
        formRequired.value = props.field.required;
        formOptions.value = props.field.options ?? null;
        identifierTouched.value = true;
      } else {
        formName.value = '';
        formIdentifier.value = '';
        formType.value = 'TEXT';
        formRequired.value = false;
        formOptions.value = null;
        identifierTouched.value = false;
      }
    }
  }
);

watch(formName, (val) => {
  if (props.mode === 'add' && !identifierTouched.value) {
    formIdentifier.value = toCamelCase(val);
  }
});

const canSave = computed(() => {
  if (props.mode === 'add') {
    return formName.value.trim() && formIdentifier.value.trim();
  }
  return formName.value.trim();
});

function handleSave() {
  if (!canSave.value) return;
  emit('save', {
    identifier: formIdentifier.value.trim(),
    name: formName.value.trim(),
    type: formType.value,
    required: formRequired.value,
    options: formOptions.value,
  });
}

function handleDelete() {
  if (props.field?.id) {
    emit('delete', props.field.id);
  }
}

function updateOptions(val: unknown) {
  formOptions.value = val;
}

const canDelete = computed(() => {
  return props.mode === 'edit' && props.field?.type !== 'ENTRY_TITLE';
});
</script>

<template>
  <UModal :open="open" @close="emit('close')">
    <template #header>
      <div class="flex items-center gap-2">
        <h3 class="text-lg font-semibold">
          {{ mode === 'add' ? 'Add Field' : 'Edit Field' }}
        </h3>
        <UBadge
          v-if="mode === 'edit'"
          size="sm"
          variant="subtle"
          color="success"
        >
          {{ field?.type }}
        </UBadge>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Info bar (edit mode only) -->
        <div
          v-if="mode === 'edit'"
          class="flex items-center gap-4 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 p-3 -mt-1"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Identifier:</span>
            <span class="font-medium">{{ field?.identifier }}</span>
          </div>
          <USeparator orientation="vertical" class="h-4" />
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Used in:</span>
            <span class="font-medium">{{ entryCount ?? 0 }} entries</span>
          </div>
        </div>

        <UFormField label="Name" required>
          <UInput
            v-model="formName"
            :placeholder="mode === 'add' ? 'e.g. Publish Date' : ''"
            class="w-full"
          />
        </UFormField>

        <!-- Identifier (add mode only) -->
        <UFormField
          v-if="mode === 'add'"
          label="Identifier"
          required
          hint="camelCase, auto-generated"
        >
          <UInput
            v-model="formIdentifier"
            placeholder="e.g. publishDate"
            class="w-full"
            @input="identifierTouched = true"
          />
        </UFormField>

        <!-- Type + Required row (add mode) -->
        <div v-if="mode === 'add'" class="grid grid-cols-2 gap-4">
          <UFormField label="Type">
            <USelect
              v-model="formType"
              :items="fieldTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label=" ">
            <USwitch v-model="formRequired" label="Required" />
          </UFormField>
        </div>

        <!-- Required toggle (edit mode — type is read-only) -->
        <UFormField v-if="mode === 'edit'" label="Required">
          <USwitch v-model="formRequired" />
        </UFormField>

        <!-- Type-specific options slot -->
        <slot
          name="type-options"
          :type="formType"
          :options="formOptions"
          :update-options="updateOptions"
        />

        <!-- Danger zone (edit mode, non-ENTRY_TITLE) -->
        <div v-if="canDelete" class="pt-4">
          <USeparator color="red" />
          <div class="flex items-center justify-between pt-4">
            <div>
              <p class="text-sm font-medium text-red-700 dark:text-red-400">
                Delete this field
              </p>
              <p class="text-xs text-muted">
                Data in {{ entryCount ?? 0 }} entries will be preserved but
                hidden
              </p>
            </div>
            <UButton
              size="sm"
              variant="outline"
              color="error"
              @click="handleDelete"
            >
              Delete
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
        <UButton :disabled="!canSave" @click="handleSave">
          {{ mode === 'add' ? 'Add Field' : 'Save Changes' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Verify it passes lint and typecheck**

Run:

```bash
pnpm lint && pnpm typecheck
```

Expected: Both pass (component isn't used yet, but syntax and types should be valid).

- [ ] **Step 3: Commit**

```bash
git add components/FieldModal.vue
git commit -m "feat: create FieldModal component with add/edit modes and type-options slot"
```

---

### Task 3: Integrate FieldModal into Edit Content Type Page

**Files:**

- Modify: `pages/content-types/[id].vue`

This is the largest task — replace the inline form, add the three-dot menu, and wire up the modal for both add and edit.

- [ ] **Step 1: Replace the script section**

Replace the entire `<script setup>` section of `pages/content-types/[id].vue` with:

```typescript
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

function openAddFieldModal() {
  fieldModalMode.value = 'add';
  fieldModalField.value = null;
  fieldModalOpen.value = true;
}

function openEditFieldModal(field: {
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}) {
  fieldModalMode.value = 'edit';
  fieldModalField.value = field;
  fieldModalOpen.value = true;
}

async function handleFieldSave(data: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}) {
  try {
    if (fieldModalMode.value === 'add') {
      await $fetch(`/api/content-types/${id}/fields`, {
        method: 'POST',
        body: {
          identifier: data.identifier,
          name: data.name,
          type: data.type,
          required: data.required,
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
        `/api/content-types/${id}/fields/${fieldModalField.value?.id}`,
        {
          method: 'PUT',
          body: {
            name: data.name,
            required: data.required,
            options: data.options,
          },
        }
      );
      toast.add({
        title: 'Updated',
        description: 'Field updated successfully.',
        color: 'success',
      });
    }
    fieldModalOpen.value = false;
    await refresh();
  } catch (err: unknown) {
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

function fieldMenuItems(field: {
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}) {
  const items = [
    [
      {
        label: 'Edit',
        icon: 'i-lucide-pencil',
        onSelect: () => openEditFieldModal(field),
      },
    ],
  ];
  if (field.type !== 'ENTRY_TITLE') {
    items.push([
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => handleFieldDelete(field.id),
      },
    ]);
  }
  return items;
}
</script>
```

- [ ] **Step 2: Replace the template section**

Replace the entire `<template>` section with:

```vue
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

      <div class="flex items-center justify-between">
        <USeparator label="Fields" class="flex-1" />
        <UButton
          size="sm"
          variant="outline"
          icon="i-lucide-plus"
          class="ml-4"
          @click="openAddFieldModal"
        >
          Add Field
        </UButton>
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
              </div>
              <UDropdownMenu :items="fieldMenuItems(field)">
                <UButton size="xs" variant="ghost" icon="i-lucide-ellipsis" />
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
      :entry-count="contentType?._count.entries ?? 0"
      @close="fieldModalOpen = false"
      @save="handleFieldSave"
      @delete="handleFieldDelete"
    >
      <template #type-options="{ type, options, updateOptions }">
        <UFormField v-if="type === 'SELECT'" label="Choices (comma-separated)">
          <UInput
            :model-value="
              (options as { choices?: string[] })?.choices?.join(', ') ?? ''
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
```

- [ ] **Step 3: Verify lint and typecheck pass**

Run:

```bash
pnpm lint && pnpm typecheck
```

Expected: Both pass.

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/\[id\].vue
git commit -m "feat: integrate FieldModal into edit content type page"
```

---

### Task 4: Integrate FieldModal into New Content Type Page

**Files:**

- Modify: `pages/content-types/new.vue`

- [ ] **Step 1: Replace the script section**

Replace the entire `<script setup>` section of `pages/content-types/new.vue` with:

```typescript
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
const editingFieldIndex = ref<number | null>(null);
const fieldModalField = ref<FieldDraft | null>(null);

function openAddFieldModal() {
  fieldModalMode.value = 'add';
  fieldModalField.value = null;
  editingFieldIndex.value = null;
  fieldModalOpen.value = true;
}

function openEditFieldModal(index: number) {
  const field = fields.value[index];
  fieldModalMode.value = 'edit';
  fieldModalField.value = { ...field };
  editingFieldIndex.value = index;
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
      options: data.options,
    });
  } else if (editingFieldIndex.value !== null) {
    fields.value[editingFieldIndex.value] = {
      identifier: data.identifier,
      name: data.name,
      type: data.type,
      required: data.required,
      options: data.options,
    };
  }
  fieldModalOpen.value = false;
}

function handleFieldDelete(fieldId: string) {
  // On new page, fieldId is the identifier since fields aren't persisted yet
  // We use editingFieldIndex instead
  if (editingFieldIndex.value !== null) {
    fields.value.splice(editingFieldIndex.value, 1);
  }
  fieldModalOpen.value = false;
}

function removeField(index: number) {
  fields.value.splice(index, 1);
}

function fieldMenuItems(index: number) {
  const field = fields.value[index];
  const items = [
    [
      {
        label: 'Edit',
        icon: 'i-lucide-pencil',
        onSelect: () => openEditFieldModal(index),
      },
    ],
  ];
  if (field.type !== 'ENTRY_TITLE') {
    items.push([
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => removeField(index),
      },
    ]);
  }
  return items;
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
```

- [ ] **Step 2: Replace the template section**

Replace the entire `<template>` section with:

```vue
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

      <div class="flex items-center justify-between">
        <USeparator label="Fields" class="flex-1" />
        <UButton
          size="sm"
          variant="outline"
          icon="i-lucide-plus"
          class="ml-4"
          @click="openAddFieldModal"
        >
          Add Field
        </UButton>
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
                <UButton size="xs" variant="ghost" icon="i-lucide-ellipsis" />
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
              (options as { choices?: string[] })?.choices?.join(', ') ?? ''
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
```

- [ ] **Step 3: Verify lint and typecheck pass**

Run:

```bash
pnpm lint && pnpm typecheck
```

Expected: Both pass.

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/new.vue
git commit -m "feat: integrate FieldModal into new content type page"
```

---

### Task 5: Manual Testing and Polish

- [ ] **Step 1: Start dev server and test**

Run:

```bash
pnpm dev
```

Open http://localhost:4000 and test the following:

1. Navigate to an existing content type edit page
2. Click "Add Field" — verify modal opens in add mode
3. Fill in name, verify identifier auto-generates
4. Select a type, toggle required, click "Add Field" — verify field appears in list and modal closes
5. Click the three-dot menu on a field — verify "Edit" and "Delete" options appear
6. Click "Edit" — verify modal opens with name pre-filled, identifier and type shown as read-only, entry count displayed
7. Change name or required toggle, click "Save Changes" — verify field updates
8. Click "Delete" in the danger zone — verify field is removed
9. Verify ENTRY_TITLE field has no "Delete" option in menu and no danger zone in edit modal
10. Navigate to the "New Content Type" page and repeat steps 2-9 (with local array instead of API calls)
11. Verify drag-and-drop reordering still works on both pages
12. Create a content type with a SELECT field — verify choices input appears in the `#type-options` slot

- [ ] **Step 2: Run existing integration tests**

Run:

```bash
pnpm test:run -- server/api/content-types/content-types.test.ts
pnpm test:run -- server/api/content-entries/content-entries.test.ts
```

Expected: All existing tests still pass (API endpoints unchanged except the RICHTEXT fix).

- [ ] **Step 3: Commit any fixes from testing**

If any issues found during manual testing, fix and commit.

---

### Task 6: Update Documentation

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add FieldModal to key files and component descriptions in CLAUDE.md**

Add to the component descriptions section (near ContentEditor, RichTextEditor):

```
- **FieldModal component** — `components/FieldModal.vue` provides a modal dialog for adding and editing content type fields. Props: `open`, `mode` ('add'|'edit'), `field` (existing field data or null), `fieldTypeOptions`, `entryCount`. Emits: `close`, `save`, `delete`. Exposes a `#type-options` scoped slot (`{ type, options, updateOptions }`) for type-specific configuration UI (e.g. SELECT choices). In add mode: name, identifier (auto-generated), type dropdown, required toggle. In edit mode: name and required editable, identifier and type read-only, info bar with identifier and entry count, danger zone for deletion (hidden for ENTRY_TITLE fields).
```

Add to the Key Files section:

```
- `components/FieldModal.vue` — Modal for adding/editing content type fields with type-options slot
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add FieldModal component to documentation"
```
