# Relation Entry Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the entry-level UI for RELATION and MULTIRELATION fields — entry cards, an entry picker modal, a sliding editor pane, and a ContentEditor scoped slot for custom field rendering.

**Architecture:** Four new components (`RelationField`, `MultiRelationField`, `EntryPickerModal`, `EntryEditorPane`), two new field config types, a `#field` scoped slot on `ContentEditor`, a `useRelationResolver` composable for resolving entry references to display data, and integration in both dynamic entry pages via the scoped slot. The sliding pane reuses the existing `ContentEditor` and `useContentEntryEditor` composable internally.

**Tech Stack:** Vue 3 (Nuxt UI components, vuedraggable, CSS transitions), TypeScript, existing Nuxt server API endpoints

---

### Task 1: Field Config Types

**Files:**

- Modify: `types/contentEditor.ts`

- [ ] **Step 1: Add DynamicRelationFieldConfig and DynamicMultirelationFieldConfig**

Add these two interfaces before the `FieldConfig` union in `types/contentEditor.ts`:

```typescript
export interface DynamicRelationFieldConfig {
  type: 'dynamic-relation';
  key: string;
  label: string;
  required?: boolean;
  targetContentTypeIds: string[];
}

export interface DynamicMultirelationFieldConfig {
  type: 'dynamic-multirelation';
  key: string;
  label: string;
  targetContentTypeIds: string[];
}
```

Then add both to the `FieldConfig` union:

```typescript
export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | NumberFieldConfig
  | BooleanFieldConfig
  | DatetimeFieldConfig
  | SelectFieldConfig
  | RelationFieldConfig
  | RichtextFieldConfig
  | MultirelationFieldConfig
  | DynamicRelationFieldConfig
  | DynamicMultirelationFieldConfig;
```

- [ ] **Step 2: Commit**

```bash
git add types/contentEditor.ts
git commit -m "feat: add DynamicRelation/DynamicMultirelation field config types"
```

---

### Task 2: ContentEditor #field Scoped Slot

**Files:**

- Modify: `components/ContentEditor.vue`

- [ ] **Step 1: Wrap the field rendering loop in a slot**

In `components/ContentEditor.vue`, find the `<template v-for="field in fields" :key="field.key">` block (line 132). Wrap the entire contents of the `v-for` in a slot that provides `field`, `value`, and `update`:

Replace:

```vue
      <template v-for="field in fields" :key="field.key">
        <UFormField
          v-if="field.type === 'text'"
```

With:

```vue
      <template v-for="field in fields" :key="field.key">
        <slot
          name="field"
          :field="field"
          :value="state[field.key]"
          :update="(val: unknown) => (state[field.key] = val)"
        >
        <UFormField
          v-if="field.type === 'text'"
```

And close the slot after the last `</UFormField>` before `</template>` (after the richtext block, before `<slot name="after-fields" />`):

```vue
        </UFormField>
        </slot>
      </template>
```

The slot provides:

- `field` — the FieldConfig object
- `value` — `state[field.key]`
- `update` — function to update `state[field.key]`

When the parent doesn't provide slot content, the default content (all existing field renderers) is used. When the parent provides slot content, it can intercept specific field types and render custom components.

- [ ] **Step 2: Verify lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add components/ContentEditor.vue
git commit -m "feat: add #field scoped slot to ContentEditor"
```

---

### Task 3: RelationField Component

**Files:**

- Create: `components/RelationField.vue`

- [ ] **Step 1: Create the component**

Create `components/RelationField.vue`:

```vue
<script setup lang="ts">
defineProps<{
  label: string;
  required?: boolean;
  value: { contentTypeId: string; entryId: string } | null;
  entryTitle: string | null;
  contentTypeName: string | null;
}>();

const emit = defineEmits<{
  add: [];
  edit: [];
  remove: [];
}>();
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-1">
      <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
        {{ label }}
      </span>
      <span v-if="required" class="text-sm text-red-500">*</span>
    </div>
    <div
      v-if="!value"
      class="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 gap-2 cursor-pointer hover:border-gray-400 transition-colors"
      @click="emit('add')"
    >
      <UIcon name="i-lucide-plus" class="size-4 text-muted" />
      <span class="text-sm font-medium text-muted">Add entry</span>
    </div>
    <div
      v-else
      class="flex items-center h-14 px-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
      @click="emit('edit')"
    >
      <div
        class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0"
      >
        <span class="text-xs font-semibold text-blue-700 dark:text-blue-300">
          {{ (contentTypeName ?? '?').charAt(0).toUpperCase() }}
        </span>
      </div>
      <div class="flex-1 min-w-0">
        <p
          class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
        >
          {{ entryTitle ?? 'Untitled' }}
        </p>
        <p class="text-xs text-muted">
          {{ contentTypeName ?? 'Unknown type' }}
        </p>
      </div>
      <UButton
        size="xs"
        variant="ghost"
        icon="i-lucide-x"
        class="shrink-0 opacity-50 hover:opacity-100"
        @click.stop="emit('remove')"
      />
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0" />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add components/RelationField.vue
git commit -m "feat: create RelationField component"
```

---

### Task 4: MultiRelationField Component

**Files:**

- Create: `components/MultiRelationField.vue`

- [ ] **Step 1: Create the component**

Create `components/MultiRelationField.vue`:

```vue
<script setup lang="ts">
import draggable from 'vuedraggable';

interface RelationItem {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
  contentTypeName: string;
}

const props = defineProps<{
  label: string;
  items: RelationItem[];
}>();

const emit = defineEmits<{
  add: [];
  edit: [index: number];
  remove: [index: number];
  reorder: [items: Array<{ contentTypeId: string; entryId: string }>];
}>();

const draggableItems = computed({
  get: () => props.items,
  set: (val) => {
    emit(
      'reorder',
      val.map((item) => ({
        contentTypeId: item.contentTypeId,
        entryId: item.entryId,
      }))
    );
  },
});
</script>

<template>
  <div class="space-y-2">
    <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
      {{ label }}
    </span>
    <div class="space-y-1.5">
      <draggable
        v-model="draggableItems"
        item-key="entryId"
        handle=".drag-handle"
        animation="150"
        class="space-y-1.5"
      >
        <template #item="{ element: item, index: idx }">
          <div
            class="flex items-center h-14 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0 size-3.5"
            />
            <div
              class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 shrink-0"
              @click="emit('edit', idx)"
            >
              <span
                class="text-xs font-semibold text-blue-700 dark:text-blue-300"
              >
                {{ item.contentTypeName.charAt(0).toUpperCase() }}
              </span>
            </div>
            <div class="flex-1 min-w-0" @click="emit('edit', idx)">
              <p
                class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
              >
                {{ item.entryTitle || 'Untitled' }}
              </p>
              <p class="text-xs text-muted">{{ item.contentTypeName }}</p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              class="shrink-0 opacity-50 hover:opacity-100"
              @click.stop="emit('remove', idx)"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-muted shrink-0"
              @click="emit('edit', idx)"
            />
          </div>
        </template>
      </draggable>
      <div
        class="flex items-center justify-center h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 gap-2 cursor-pointer hover:border-gray-400 transition-colors"
        @click="emit('add')"
      >
        <UIcon name="i-lucide-plus" class="size-3.5 text-muted" />
        <span class="text-sm font-medium text-muted">Add entry</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add components/MultiRelationField.vue
git commit -m "feat: create MultiRelationField component"
```

---

### Task 5: EntryPickerModal Component

**Files:**

- Create: `components/EntryPickerModal.vue`

- [ ] **Step 1: Create the component**

Create `components/EntryPickerModal.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  targetContentTypeIds: string[];
}>();

const emit = defineEmits<{
  select: [
    data: { contentTypeId: string; entryId: string; entryTitle: string },
  ];
  create: [contentTypeId: string];
  close: [];
}>();

// Fetch content type metadata for tabs
const { data: contentTypeOptions } = useFetch<
  { label: string; value: string }[]
>('/api/content-types/options');

const targetTypes = computed(() =>
  (contentTypeOptions.value ?? []).filter((o) =>
    props.targetContentTypeIds.includes(o.value)
  )
);

const activeTab = ref<string | null>(null);
const searchQuery = ref('');
const createPopoverOpen = ref(false);

// Reset state when modal opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      activeTab.value = null;
      searchQuery.value = '';
      createPopoverOpen.value = false;
    }
  }
);

// Fetch entries for each target type
const entries = ref<
  Array<{
    id: string;
    contentTypeId: string;
    contentTypeName: string;
    entryTitle: string;
  }>
>([]);

const isLoading = ref(false);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    isLoading.value = true;
    const results: typeof entries.value = [];

    for (const typeId of props.targetContentTypeIds) {
      const data = await $fetch<{
        items: Array<{ id: string; data: Record<string, unknown> }>;
      }>('/api/content-entries', {
        query: { contentTypeId: typeId, perPage: 100 },
      });

      const typeName =
        targetTypes.value.find((t) => t.value === typeId)?.label ?? 'Unknown';

      // Find ENTRY_TITLE field to extract display name
      const contentType = await $fetch<{
        fields: Array<{ identifier: string; type: string }>;
      }>(`/api/content-types/${typeId}`);
      const titleField = contentType.fields.find(
        (f) => f.type === 'ENTRY_TITLE'
      );
      const titleKey = titleField?.identifier ?? 'title';

      for (const item of data.items) {
        results.push({
          id: item.id,
          contentTypeId: typeId,
          contentTypeName: typeName,
          entryTitle: (item.data[titleKey] as string) ?? 'Untitled',
        });
      }
    }

    entries.value = results;
    isLoading.value = false;
  }
);

const filteredEntries = computed(() => {
  let list = entries.value;
  if (activeTab.value) {
    list = list.filter((e) => e.contentTypeId === activeTab.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((e) => e.entryTitle.toLowerCase().includes(q));
  }
  return list;
});

function handleSelect(entry: (typeof entries.value)[0]) {
  emit('select', {
    contentTypeId: entry.contentTypeId,
    entryId: entry.id,
    entryTitle: entry.entryTitle,
  });
}

function handleCreate(contentTypeId: string) {
  createPopoverOpen.value = false;
  emit('create', contentTypeId);
}
</script>

<template>
  <UModal :open="open" @close="emit('close')">
    <template #header>
      <h3 class="text-lg font-semibold">Link Entry</h3>
    </template>

    <template #body>
      <div class="space-y-4 -mt-2">
        <!-- Type tabs -->
        <div v-if="targetTypes.length > 1" class="flex gap-1 flex-wrap">
          <UButton
            size="xs"
            :variant="activeTab === null ? 'solid' : 'soft'"
            :color="activeTab === null ? 'neutral' : 'neutral'"
            @click="activeTab = null"
          >
            All
          </UButton>
          <UButton
            v-for="t in targetTypes"
            :key="t.value"
            size="xs"
            :variant="activeTab === t.value ? 'solid' : 'soft'"
            :color="activeTab === t.value ? 'neutral' : 'neutral'"
            @click="activeTab = t.value"
          >
            {{ t.label }}
          </UButton>
        </div>

        <!-- Search -->
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Search entries..."
          class="w-full"
        />

        <!-- Entry list -->
        <div v-if="isLoading" class="flex justify-center py-8">
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin size-6 text-muted"
          />
        </div>
        <div v-else class="max-h-72 overflow-y-auto -mx-2">
          <div
            v-for="entry in filteredEntries"
            :key="entry.id"
            class="flex items-center h-12 px-3 mx-0 rounded-lg gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            @click="handleSelect(entry)"
          >
            <div
              class="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-700 shrink-0"
            >
              <span
                class="text-xs font-semibold text-gray-600 dark:text-gray-300"
              >
                {{ entry.contentTypeName.charAt(0).toUpperCase() }}
              </span>
            </div>
            <span class="text-sm font-medium flex-1 truncate">
              {{ entry.entryTitle }}
            </span>
            <span class="text-xs text-muted shrink-0">
              {{ entry.contentTypeName }}
            </span>
          </div>
          <p
            v-if="filteredEntries.length === 0 && !isLoading"
            class="text-sm text-muted text-center py-6"
          >
            No entries found
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <div class="relative">
          <div
            v-if="createPopoverOpen && targetTypes.length > 1"
            class="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden z-10"
          >
            <div class="px-3 pt-2 pb-1">
              <span
                class="text-xs font-medium text-muted uppercase tracking-wide"
              >
                Create new
              </span>
            </div>
            <div
              v-for="t in targetTypes"
              :key="t.value"
              class="flex items-center h-10 px-3 gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              @click="handleCreate(t.value)"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-700 shrink-0"
              >
                <span
                  class="text-xs font-semibold text-gray-600 dark:text-gray-300"
                >
                  {{ t.label.charAt(0).toUpperCase() }}
                </span>
              </div>
              <span class="text-sm font-medium">{{ t.label }}</span>
            </div>
          </div>
          <UButton
            icon="i-lucide-plus"
            @click="
              targetTypes.length === 1
                ? handleCreate(targetTypes[0].value)
                : (createPopoverOpen = !createPopoverOpen)
            "
          >
            Create new...
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Verify lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add components/EntryPickerModal.vue
git commit -m "feat: create EntryPickerModal component"
```

---

### Task 6: EntryEditorPane Component

**Files:**

- Create: `components/EntryEditorPane.vue`

- [ ] **Step 1: Create the component**

Create `components/EntryEditorPane.vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const props = defineProps<{
  open: boolean;
  contentTypeId: string;
  entryId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [data: { contentTypeId: string; entryId: string; entryTitle: string }];
}>();

// Fetch content type for field definitions
const { data: contentType } = useFetch<{
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
}>(() => `/api/content-types/${props.contentTypeId}`, {
  watch: [() => props.contentTypeId],
});

const hasSlugField = computed(
  () => contentType.value?.fields.some((f) => f.type === 'SLUG') ?? false
);

const entryTitleFieldIdentifier = computed(() => {
  const field = contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE');
  return field?.identifier ?? 'title';
});

const editorFields = computed<FieldConfig[]>(() => {
  if (!contentType.value) return [];
  return contentType.value.fields
    .filter((f) => f.type !== 'SLUG')
    .map((f) => {
      switch (f.type) {
        case 'ENTRY_TITLE':
        case 'TEXT':
          return {
            type: 'text' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
          };
        case 'TEXTAREA':
          return {
            type: 'textarea' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
          };
        case 'NUMBER':
          return {
            type: 'number' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
          };
        case 'BOOLEAN':
          return { type: 'boolean' as const, key: f.identifier, label: f.name };
        case 'DATETIME':
          return {
            type: 'datetime' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
          };
        case 'SELECT': {
          const opts = f.options as { choices?: string[] } | null;
          return {
            type: 'select' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
            options: (opts?.choices ?? []).map((c) => ({ label: c, value: c })),
          };
        }
        case 'RICHTEXT':
          return {
            type: 'richtext' as const,
            key: f.identifier,
            label: f.name,
          };
        default:
          return {
            type: 'text' as const,
            key: f.identifier,
            label: f.name,
            required: f.required,
          };
      }
    });
});

// Entry editor composable
const effectiveEntryId = computed(() => props.entryId ?? 'new');
const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEntryEditor(props.contentTypeId, effectiveEntryId.value);

const pageTitle = computed(() => {
  if (!props.entryId) return `New ${contentType.value?.name ?? 'Entry'}`;
  const titleVal = formState[entryTitleFieldIdentifier.value];
  if (typeof titleVal === 'string' && titleVal) return titleVal;
  return contentType.value?.name ?? 'Entry';
});

async function handleSave() {
  const newId = await save();
  const entryId = newId ?? props.entryId;
  if (entryId) {
    const titleVal = formState[entryTitleFieldIdentifier.value];
    emit('saved', {
      contentTypeId: props.contentTypeId,
      entryId,
      entryTitle: typeof titleVal === 'string' ? titleVal : 'Untitled',
    });
  }
}
</script>

<template>
  <Transition name="slide-pane">
    <div v-if="open" class="fixed inset-0 z-50 flex">
      <!-- Backdrop / sliver -->
      <div
        class="w-10 shrink-0 bg-gray-200/50 dark:bg-gray-900/50 backdrop-blur-sm cursor-pointer"
        @click="emit('close')"
      />
      <!-- Pane -->
      <div class="flex-1 flex flex-col bg-white dark:bg-gray-900 shadow-2xl">
        <!-- Header -->
        <div
          class="flex items-center gap-4 px-6 py-4 border-b border-gray-200 dark:border-gray-700"
        >
          <UButton
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="emit('close')"
          />
          <USeparator orientation="vertical" class="h-5" />
          <NuxtLink
            :to="`/content-types/${contentTypeId}`"
            target="_blank"
            class="flex items-center gap-1.5 text-xs text-muted hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {{ contentType?.name ?? 'Content Type' }}
            <UIcon name="i-lucide-external-link" class="size-3" />
          </NuxtLink>
          <div class="flex-1" />
          <span class="text-sm font-semibold">{{ pageTitle }}</span>
          <div class="flex-1" />
          <UButton :loading="isSaving" @click="handleSave"> Save </UButton>
        </div>
        <!-- Body -->
        <div class="flex-1 overflow-y-auto">
          <ContentEditor
            v-model:state="formState"
            :title="pageTitle"
            :fields="editorFields"
            :loading="loadingStatus === 'pending'"
            :saving="isSaving"
            :error="saveError"
            :show-slug="hasSlugField"
            :on-save="handleSave"
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
```

- [ ] **Step 2: Verify lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add components/EntryEditorPane.vue
git commit -m "feat: create EntryEditorPane sliding pane component"
```

---

### Task 7: useRelationResolver Composable

**Files:**

- Create: `composables/useRelationResolver.ts`

- [ ] **Step 1: Create the composable**

Create `composables/useRelationResolver.ts`. This composable resolves `{ contentTypeId, entryId }` references into display data (entry title, content type name).

```typescript
interface RelationRef {
  contentTypeId: string;
  entryId: string;
}

interface ResolvedRelation {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
  contentTypeName: string;
}

export function useRelationResolver() {
  const cache = reactive<
    Record<string, { entryTitle: string; contentTypeName: string }>
  >({});

  const contentTypeNames = reactive<Record<string, string>>({});

  async function resolveContentTypeName(
    contentTypeId: string
  ): Promise<string> {
    if (contentTypeNames[contentTypeId]) return contentTypeNames[contentTypeId];
    const ct = await $fetch<{ name: string }>(
      `/api/content-types/${contentTypeId}`
    );
    contentTypeNames[contentTypeId] = ct.name;
    return ct.name;
  }

  async function resolveRef(ref: RelationRef): Promise<ResolvedRelation> {
    const cacheKey = `${ref.contentTypeId}:${ref.entryId}`;
    if (cache[cacheKey]) {
      return {
        ...ref,
        entryTitle: cache[cacheKey].entryTitle,
        contentTypeName: cache[cacheKey].contentTypeName,
      };
    }

    const [entry, contentTypeName] = await Promise.all([
      $fetch<{
        data: Record<string, unknown>;
        contentType?: {
          name: string;
          fields: Array<{ identifier: string; type: string }>;
        };
      }>(`/api/content-entries/${ref.entryId}`),
      resolveContentTypeName(ref.contentTypeId),
    ]);

    const titleField = entry.contentType?.fields.find(
      (f) => f.type === 'ENTRY_TITLE'
    );
    const titleKey = titleField?.identifier ?? 'title';
    const entryTitle = (entry.data[titleKey] as string) ?? 'Untitled';

    cache[cacheKey] = { entryTitle, contentTypeName };

    return { ...ref, entryTitle, contentTypeName };
  }

  async function resolveRefs(refs: RelationRef[]): Promise<ResolvedRelation[]> {
    return Promise.all(refs.map((r) => resolveRef(r)));
  }

  function updateCache(
    contentTypeId: string,
    entryId: string,
    entryTitle: string
  ) {
    const cacheKey = `${contentTypeId}:${entryId}`;
    const existing = cache[cacheKey];
    if (existing) {
      cache[cacheKey] = { ...existing, entryTitle };
    }
  }

  return { resolveRef, resolveRefs, updateCache };
}
```

- [ ] **Step 2: Commit**

```bash
git add composables/useRelationResolver.ts
git commit -m "feat: create useRelationResolver composable"
```

---

### Task 8: Integrate into Entry Edit Page

**Files:**

- Modify: `pages/content-types/[id]/entries/[entryId].vue`

This is the main integration task. The entry edit page needs to:

1. Map RELATION/MULTIRELATION to the new field config types
2. Use the `#field` scoped slot to render RelationField/MultiRelationField
3. Manage picker modal and editor pane state
4. Resolve relation references for display

- [ ] **Step 1: Add RELATION/MULTIRELATION cases to mapFieldToConfig**

In the `mapFieldToConfig` function, add before the `default` case:

```typescript
    case 'RELATION': {
      const opts = field.options as { targetContentTypeIds?: string[] } | null;
      return {
        type: 'dynamic-relation' as const,
        key: field.identifier,
        label: field.name,
        required: field.required,
        targetContentTypeIds: opts?.targetContentTypeIds ?? [],
      };
    }
    case 'MULTIRELATION': {
      const opts = field.options as { targetContentTypeIds?: string[] } | null;
      return {
        type: 'dynamic-multirelation' as const,
        key: field.identifier,
        label: field.name,
        targetContentTypeIds: opts?.targetContentTypeIds ?? [],
      };
    }
```

- [ ] **Step 2: Add relation state management to the script**

Add after the existing `handleSave` function:

```typescript
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
  contentTypeId: string,
  entryId: string | null,
  fieldKey: string
) {
  paneContentTypeId.value = contentTypeId;
  paneEntryId.value = entryId;
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
    // If this was a "create new", append to the array
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
  paneOpen.value = false;
}
```

- [ ] **Step 3: Update the template to use the #field slot and add modals/pane**

Replace the `<template>` section:

```vue
<template>
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
        :value="value as { contentTypeId: string; entryId: string } | null"
        :entry-title="resolvedRelations[field.key]?.entryTitle ?? null"
        :content-type-name="
          resolvedRelations[field.key]?.contentTypeName ?? null
        "
        @add="openPicker(field.key, (field as any).targetContentTypeIds)"
        @edit="openPane((value as any).contentTypeId, (value as any).entryId, field.key)"
        @remove="update(null)"
      />
      <MultiRelationField
        v-else-if="field.type === 'dynamic-multirelation'"
        :label="field.label"
        :items="resolvedMultiRelations[field.key] ?? []"
        @add="openPicker(field.key, (field as any).targetContentTypeIds)"
        @edit="(idx: number) => {
          const refs = value as Array<{ contentTypeId: string; entryId: string }>;
          openPane(refs[idx].contentTypeId, refs[idx].entryId, field.key);
        }"
        @remove="(idx: number) => {
          const refs = [...(value as Array<{ contentTypeId: string; entryId: string }>)];
          refs.splice(idx, 1);
          update(refs);
        }"
        @reorder="(items) => update(items)"
      />
    </template>
  </ContentEditor>

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
</template>
```

- [ ] **Step 4: Verify lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add pages/content-types/\[id\]/entries/\[entryId\].vue
git commit -m "feat: integrate relation field components into entry edit page"
```

---

### Task 9: Integrate into Entry New Page

**Files:**

- Modify: `pages/content-types/[id]/entries/new.vue`

Same changes as Task 8 but for the new entry page. The logic is identical — same `mapFieldToConfig` cases, same relation state management, same slot usage. Read the file and apply the same pattern.

- [ ] **Step 1: Add RELATION/MULTIRELATION cases to mapFieldToConfig**

Same two cases as Task 8 Step 1.

- [ ] **Step 2: Add relation state management**

Same code as Task 8 Step 2 (resolveRef, pickerOpen, paneOpen, etc.).

- [ ] **Step 3: Update the template**

Same slot usage and modals/pane as Task 8 Step 3.

- [ ] **Step 4: Verify lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add pages/content-types/\[id\]/entries/new.vue
git commit -m "feat: integrate relation field components into entry new page"
```

---

### Task 10: Manual Testing

- [ ] **Step 1: Test the full flow**

Start dev server (`pnpm dev`) and test:

1. Create a content type "Author" with an ENTRY_TITLE field
2. Create a content type "Article" with ENTRY_TITLE + a RELATION field targeting Author + a MULTIRELATION field targeting Author
3. Create two Author entries
4. Create an Article entry:
   - Verify the RELATION field shows the empty "Add entry" card
   - Click "Add entry" → verify the picker modal opens with Author entries
   - Select an author → verify the card appears with name and type
   - Click the card → verify the sliding pane opens with the author's fields
   - Close the pane, verify the card is still there
   - Click the × on the card → verify it unlinks (card goes back to empty)
5. Test MULTIRELATION:
   - Click "Add entry" → select an author → card appears
   - Click "Add entry" again → select another author → second card appears
   - Drag to reorder → verify order updates
   - Click × on a card → verify it removes without affecting others
6. Test "Create new" flow:
   - Click "Add entry" → click "Create new..." → verify pane opens in create mode
   - Fill in the new entry, click Save → verify card appears in the field

- [ ] **Step 2: Run existing tests**

```bash
pnpm test -- --run
```

Expected: All existing tests pass (no API changes in this spec).

- [ ] **Step 3: Commit any fixes**

---

### Task 11: Update Documentation

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new components and composable to CLAUDE.md**

Add to the component descriptions section:

```
- **RelationField component** — `components/RelationField.vue` renders a single RELATION field in the entry editor. Shows an empty "Add entry" card or a filled card with entry title, content type initial, and remove button. Emits: `add`, `edit`, `remove`.
- **MultiRelationField component** — `components/MultiRelationField.vue` renders a MULTIRELATION field with draggable entry cards and an "Add entry" button. Uses vuedraggable for reordering. Emits: `add`, `edit(index)`, `remove(index)`, `reorder(items)`.
- **EntryPickerModal component** — `components/EntryPickerModal.vue` modal for searching and selecting existing entries from allowed target content types. Type filter tabs, search input, scrollable entry list. "Create new..." button with type popover for multiple targets. Emits: `select`, `create(contentTypeId)`, `close`.
- **EntryEditorPane component** — `components/EntryEditorPane.vue` sliding full-screen pane for creating or editing a related entry. Contentful-inspired stacked pane pattern with parent page sliver visible on the left. Uses `ContentEditor` and `useContentEntryEditor` internally. CSS transition slide-in from right. Emits: `close`, `saved`.
```

Add to the composables section:

```
- **useRelationResolver composable** — `composables/useRelationResolver.ts` resolves `{ contentTypeId, entryId }` relation references into display data (entry title, content type name). Caches results to avoid re-fetching.
```

Add to the Key Files section:

```
- `components/RelationField.vue` — Single relation entry card (empty/filled states)
- `components/MultiRelationField.vue` — Multi relation draggable entry cards
- `components/EntryPickerModal.vue` — Entry picker modal with type tabs and search
- `components/EntryEditorPane.vue` — Sliding pane for editing related entries
- `composables/useRelationResolver.ts` — Resolves relation references to display data
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add relation entry editor components to documentation"
```
