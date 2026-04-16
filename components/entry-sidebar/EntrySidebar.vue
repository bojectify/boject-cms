<script setup lang="ts">
import type { EntrySidebarProps } from './entrySidebar.types';
import { QA_ENTRY_SIDEBAR } from './entrySidebar.config';

const props = withDefaults(defineProps<EntrySidebarProps>(), {
  testId: QA_ENTRY_SIDEBAR.COMPONENT,
});

const { formatDate } = useContentTable();
const toast = useToast();

const isPublished = computed(
  () => props.status === 'PUBLISHED' && !props.isDirty
);
const isPublishedDirty = computed(
  () => props.status === 'PUBLISHED' && props.isDirty
);
const isChanged = computed(() => props.status === 'CHANGED');

const primaryLabel = computed(() => {
  if (isChanged.value) return 'Publish Changes';
  if (isPublished.value) return 'Published';
  return 'Publish';
});

const primaryDisabled = computed(
  () => isPublished.value || isPublishedDirty.value || props.saving
);

const secondaryLabel = computed(() => {
  if (isChanged.value) return 'Save Changes';
  return 'Save Draft';
});

const secondaryVisible = computed(() => !isPublished.value);

const statusBadgeColor = computed(() => {
  switch (props.status) {
    case 'DRAFT':
      return 'info' as const;
    case 'PUBLISHED':
      return 'success' as const;
    case 'CHANGED':
      return 'warning' as const;
    case 'ARCHIVED':
      return 'neutral' as const;
    default:
      return 'neutral' as const;
  }
});

const statusBadgeLabel = computed(() => {
  switch (props.status) {
    case 'DRAFT':
      return 'Draft';
    case 'PUBLISHED':
      return 'Published';
    case 'CHANGED':
      return 'Changed';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return props.status;
  }
});

const showPublishedRow = computed(() => props.publishedAt !== null);
const showInformation = computed(() => !props.isNew && props.entryId !== null);

const formattedEntryId = computed(() => props.entryId ?? '');
const truncatedEntryId = computed(() => {
  const id = formattedEntryId.value;
  if (!id) return '';
  return id.length > 12 ? `${id.slice(0, 8)}-${id.slice(9, 13)}…` : id;
});

async function copyEntryId() {
  if (!props.entryId) return;
  try {
    await navigator.clipboard.writeText(props.entryId);
    toast.add({
      title: 'Copied',
      description: 'Entry ID copied to clipboard.',
      color: 'success',
    });
  } catch {
    toast.add({
      title: 'Copy failed',
      description: 'Clipboard unavailable in this browser.',
      color: 'error',
    });
  }
}
</script>

<template>
  <aside
    :data-testid="testId"
    class="flex flex-col gap-6 p-6 bg-gray-50/60 dark:bg-gray-900/40"
  >
    <!-- Actions -->
    <div class="flex flex-col gap-2">
      <UButton
        block
        :loading="saving && !secondaryVisible"
        :disabled="primaryDisabled"
        icon="i-lucide-send"
        :data-testid="QA_ENTRY_SIDEBAR.PUBLISH_BTN"
        @click="onPublish"
      >
        {{ primaryLabel }}
      </UButton>
      <UButton
        v-if="secondaryVisible"
        block
        variant="soft"
        :loading="saving"
        :data-testid="QA_ENTRY_SIDEBAR.SAVE_BTN"
        @click="onSaveDraft"
      >
        {{ secondaryLabel }}
      </UButton>
    </div>

    <USeparator />

    <!-- Publishing -->
    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Publishing
      </h3>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">Status</span>
        <UBadge
          :color="statusBadgeColor"
          variant="subtle"
          :data-testid="QA_ENTRY_SIDEBAR.STATUS_BADGE"
        >
          {{ statusBadgeLabel }}
        </UBadge>
      </div>
      <div
        v-if="showPublishedRow"
        class="flex items-center justify-between text-sm"
      >
        <span class="text-muted">Published</span>
        <span>{{ formatDate(publishedAt as string) }}</span>
      </div>
    </div>

    <template v-if="showInformation">
      <USeparator />

      <!-- Information -->
      <div class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
          Information
        </h3>
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="text-muted shrink-0">Entry ID</span>
          <div class="flex items-center gap-1 min-w-0">
            <span
              class="font-mono text-xs text-muted truncate"
              :title="formattedEntryId"
            >
              {{ truncatedEntryId }}
            </span>
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              :data-testid="QA_ENTRY_SIDEBAR.COPY_ID_BTN"
              aria-label="Copy entry ID"
              @click="copyEntryId"
            />
          </div>
        </div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted">Content Type</span>
          <NuxtLink
            :to="`/content-types/${contentTypeId}`"
            class="hover:underline"
          >
            {{ contentTypeName }}
          </NuxtLink>
        </div>
        <div v-if="createdAt" class="flex items-center justify-between text-sm">
          <span class="text-muted">Created</span>
          <span>{{ formatDate(createdAt as string) }}</span>
        </div>
        <div v-if="updatedAt" class="flex items-center justify-between text-sm">
          <span class="text-muted">Updated</span>
          <span>{{ formatDate(updatedAt as string) }}</span>
        </div>
      </div>
    </template>

    <template v-if="isChanged && onDiscardChanges">
      <USeparator />
      <UButton
        block
        variant="ghost"
        color="error"
        :data-testid="QA_ENTRY_SIDEBAR.DISCARD_BTN"
        @click="onDiscardChanges"
      >
        Discard Changes
      </UButton>
    </template>
  </aside>
</template>
