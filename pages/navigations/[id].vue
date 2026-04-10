<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
];

const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEditor('navigations', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
    }
  }
);

async function handleSave() {
  await save();
}

// Navigation items management
type NavItemData = {
  id: string;
  order: number;
  linkId: string;
  parentId: string | null;
  link: { id: string; label: string; url: string | null };
  children?: NavItemData[];
};

const { data: navData, refresh: refreshNav } = await useFetch<{
  items: NavItemData[];
}>(`/api/navigations/${id}`, {
  transform: (data) => data as { items: NavItemData[] },
});

const items = computed(() => navData.value?.items ?? []);

const linkOptions = ref<{ label: string; value: string }[]>([]);
const selectedLinkId = ref('');

onMounted(async () => {
  linkOptions.value =
    await $fetch<{ label: string; value: string }[]>('/api/links/options');
});

async function addItem() {
  if (!selectedLinkId.value) return;
  await $fetch('/api/navigation-items', {
    method: 'POST',
    body: {
      navigationId: id,
      linkId: selectedLinkId.value,
      order: items.value.length,
    },
  });
  selectedLinkId.value = '';
  await refreshNav();
}

async function removeItem(itemId: string) {
  await fetch(
    `/api/navigation-items/${itemId}?navigationId=${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  await refreshNav();
}

async function moveItem(
  itemId: string,
  direction: 'up' | 'down',
  siblings: NavItemData[]
) {
  const idx = siblings.findIndex((i) => i.id === itemId);
  if (
    (direction === 'up' && idx <= 0) ||
    (direction === 'down' && idx >= siblings.length - 1)
  )
    return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  const reordered = siblings.map((item, i) => ({
    id: item.id,
    order:
      i === idx
        ? siblings[swapIdx]!.order
        : i === swapIdx
          ? siblings[idx]!.order
          : item.order,
    parentId: item.parentId,
  }));

  await $fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    body: { navigationId: id, items: reordered },
  });
  await refreshNav();
}
</script>

<template>
  <div>
    <ContentEditor
      v-model:state="formState"
      :title="formState.name ? String(formState.name) : 'Navigation'"
      :fields="fields"
      :loading="loadingStatus === 'pending'"
      :saving="isSaving"
      :error="saveError"
      :show-slug="false"
      :on-save="handleSave"
    />

    <div class="p-6 max-w-2xl">
      <USeparator label="Navigation Items" class="mb-6" />

      <div class="space-y-2">
        <div v-for="item in items" :key="item.id" class="border rounded-lg p-3">
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ item.link.label }}</span>
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-up"
                @click="moveItem(item.id, 'up', items)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-down"
                @click="moveItem(item.id, 'down', items)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="removeItem(item.id)"
              />
            </div>
          </div>
          <div v-if="item.children?.length" class="ml-6 mt-2 space-y-2">
            <div
              v-for="child in item.children"
              :key="child.id"
              class="flex items-center justify-between border rounded p-2"
            >
              <span class="text-sm">{{ child.link.label }}</span>
              <div class="flex gap-1">
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-chevron-up"
                  @click="moveItem(child.id, 'up', item.children!)"
                />
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-chevron-down"
                  @click="moveItem(child.id, 'down', item.children!)"
                />
                <UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-lucide-trash-2"
                  @click="removeItem(child.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-2 mt-4">
        <USelect
          v-model="selectedLinkId"
          :items="linkOptions"
          value-key="value"
          placeholder="Select a link..."
          class="flex-1"
        />
        <UButton
          icon="i-lucide-plus"
          :disabled="!selectedLinkId"
          @click="addItem"
        >
          Add Item
        </UButton>
      </div>
    </div>
  </div>
</template>
