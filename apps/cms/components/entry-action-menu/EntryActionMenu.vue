<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import type {
  EntryActionMenuProps,
  EntryAction,
} from './entryActionMenu.types';
import { QA_ENTRY_ACTION_MENU } from './entryActionMenu.config';

const props = withDefaults(defineProps<EntryActionMenuProps>(), {
  testId: QA_ENTRY_ACTION_MENU.COMPONENT,
});

const emit = defineEmits<{
  (e: 'action', action: EntryAction): void;
}>();

const unpublishConfirmPending = ref(false);
let unpublishTimer: ReturnType<typeof setTimeout> | null = null;

const archiveModalOpen = ref(false);
const archiveError = ref<string | null>(null);
const archiveLoading = ref(false);

function armUnpublishConfirm() {
  unpublishConfirmPending.value = true;
  if (unpublishTimer) clearTimeout(unpublishTimer);
  unpublishTimer = setTimeout(() => {
    unpublishConfirmPending.value = false;
  }, 3_000);
}

function handleUnpublish() {
  if (!unpublishConfirmPending.value) {
    armUnpublishConfirm();
    return;
  }
  unpublishConfirmPending.value = false;
  if (unpublishTimer) clearTimeout(unpublishTimer);
  emit('action', 'unpublish');
}

function openArchiveModal() {
  archiveError.value = null;
  archiveModalOpen.value = true;
}

async function confirmArchive() {
  archiveLoading.value = true;
  archiveError.value = null;
  emit('action', 'archive');
  // Optimistic close. Parent can reopen via setArchiveError on 409.
  archiveModalOpen.value = false;
  archiveLoading.value = false;
}

const items = computed<DropdownMenuItem[][]>(() => {
  const lifecycle: DropdownMenuItem[] = [];
  if (props.hasPublishedVersion) {
    lifecycle.push({
      label: unpublishConfirmPending.value
        ? 'Click again to confirm'
        : 'Unpublish',
      icon: 'i-lucide-eye-off',
      onSelect: (e?: Event) => {
        e?.preventDefault();
        handleUnpublish();
      },
    });
    lifecycle.push({
      label: 'Republish',
      icon: 'i-lucide-refresh-cw',
      onSelect: () => emit('action', 'republish'),
    });
    lifecycle.push({
      label: 'Archive',
      icon: 'i-lucide-archive',
      onSelect: () => openArchiveModal(),
    });
  }
  if (props.hasArchivedVersion) {
    lifecycle.push({
      label: 'Unarchive',
      icon: 'i-lucide-archive-restore',
      onSelect: () => emit('action', 'unarchive'),
    });
  }

  const danger: DropdownMenuItem[] = [
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => emit('action', 'delete'),
    },
  ];

  return lifecycle.length > 0 ? [lifecycle, danger] : [danger];
});

defineExpose({
  setArchiveError: (msg: string) => {
    archiveError.value = msg;
    archiveLoading.value = false;
    archiveModalOpen.value = true;
  },
});
</script>

<template>
  <div :data-testid="testId" class="inline-flex">
    <UDropdownMenu :items="items">
      <UButton
        icon="i-lucide-more-horizontal"
        color="neutral"
        variant="ghost"
        aria-label="More actions"
        :data-testid="QA_ENTRY_ACTION_MENU.TRIGGER"
      />
    </UDropdownMenu>

    <UModal
      v-model:open="archiveModalOpen"
      :data-testid="QA_ENTRY_ACTION_MENU.ARCHIVE_MODAL"
    >
      <template #content>
        <div class="p-6 max-w-md">
          <h3 class="text-lg font-semibold mb-2">Archive this entry?</h3>
          <p class="text-sm text-muted mb-4">
            Archived entries are hidden from lists and pickers. You can
            unarchive later.
          </p>
          <UAlert
            v-if="archiveError"
            color="error"
            :title="archiveError"
            class="mb-4"
          />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="subtle"
              :data-testid="QA_ENTRY_ACTION_MENU.ARCHIVE_CANCEL"
              @click="archiveModalOpen = false"
            >
              Cancel
            </UButton>
            <UButton
              color="warning"
              :loading="archiveLoading"
              :data-testid="QA_ENTRY_ACTION_MENU.ARCHIVE_CONFIRM"
              @click="confirmArchive"
            >
              Archive
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
