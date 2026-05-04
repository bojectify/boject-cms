<script setup lang="ts">
import type { ImageFieldProps, ImageFieldValue } from './imageField.types';
import { QA_IMAGE_FIELD } from './imageField.config';

export type { ImageFieldValue };

const _props = withDefaults(defineProps<ImageFieldProps>(), {
  testId: QA_IMAGE_FIELD.COMPONENT,
});

const emit = defineEmits<{
  'update:modelValue': [value: ImageFieldValue | null];
}>();

const uploading = ref(false);
const errorMessage = ref<string | null>(null);

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'data' in err) {
    const data = (err as { data?: unknown }).data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
    ) {
      return (data as { message: string }).message;
    }
  }
  return String(err);
}

async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  errorMessage.value = null;
  uploading.value = true;

  try {
    const form = new FormData();
    form.append('file', file);
    const response = await $fetch<{
      storageKey: string;
      mimeType: string;
      width: number;
      height: number;
      fileSize: number;
      originalName: string | null;
    }>('/api/files/upload', {
      method: 'POST',
      body: form,
    });

    emit('update:modelValue', {
      ...response,
      focalPointX: 0.5,
      focalPointY: 0.5,
    });
  } catch (err: unknown) {
    errorMessage.value = extractErrorMessage(err);
  } finally {
    uploading.value = false;
    // Clear the input so picking the same file again re-triggers change
    target.value = '';
  }
}

function onRemove() {
  emit('update:modelValue', null);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div :data-testid="testId">
    <div v-if="modelValue" class="flex items-start gap-4">
      <img
        :src="`/api/files/${modelValue.storageKey}/transform?w=400`"
        :alt="modelValue.originalName ?? ''"
        class="max-w-[200px] rounded border"
      />
      <div class="text-sm text-toned space-y-1">
        <div>{{ modelValue.width }} × {{ modelValue.height }}</div>
        <div>{{ formatBytes(modelValue.fileSize) }}</div>
        <div v-if="modelValue.originalName">{{ modelValue.originalName }}</div>
        <UButton size="xs" color="error" variant="soft" @click="onRemove">
          Remove
        </UButton>
      </div>
    </div>

    <div v-else>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        :disabled="uploading"
        @change="onFileChange"
      />
      <p v-if="uploading" class="text-sm text-muted mt-1">Uploading…</p>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
  </div>
</template>
