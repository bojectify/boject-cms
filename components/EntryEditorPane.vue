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
const { data: contentType } = useAuthedFetch<{
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
    <div v-if="open" class="absolute inset-0 z-30 flex">
      <!-- Backdrop / sliver -->
      <div
        class="w-10 shrink-0 bg-gray-200/50 dark:bg-gray-900/50 backdrop-blur-sm cursor-pointer"
        @click="emit('close')"
      />
      <!-- Pane -->
      <div
        class="flex-1 flex flex-col bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center gap-4 px-6 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0"
        >
          <UButton
            variant="ghost"
            icon="i-lucide-arrow-left"
            size="sm"
            @click="emit('close')"
          />
          <USeparator orientation="vertical" class="h-4" />
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
