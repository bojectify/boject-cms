<script setup lang="ts">
import type { EntryPickerModalProps } from './entryPickerModal.types';
import { QA_ENTRY_PICKER_MODAL } from './entryPickerModal.config';

const props = withDefaults(defineProps<EntryPickerModalProps>(), {
  testId: QA_ENTRY_PICKER_MODAL.COMPONENT,
});

const emit = defineEmits<{
  select: [
    data: { contentTypeId: string; entryId: string; entryTitle: string },
  ];
  create: [contentTypeId: string];
  close: [];
}>();

// Fetch content type metadata for tabs
const { data: contentTypeOptions } = useAuthedFetch<
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
  <UModal
    :data-testid="testId"
    :open="open"
    @update:open="
      (val: boolean) => {
        if (!val) emit('close');
      }
    "
  >
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
                ? handleCreate(targetTypes[0]!.value)
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
