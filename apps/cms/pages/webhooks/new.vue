<script setup lang="ts">
import { computed, ref } from 'vue';

interface ContentTypeOption {
  id: string;
  name: string;
  identifier: string;
}

interface CreatedWebhook {
  id: string;
  secret: string;
}

const { data: contentTypes } = await useAuthedFetch<{
  items: ContentTypeOption[];
}>('/api/content-types');

const form = ref({
  name: '',
  url: '',
  enabled: true,
  contentTypeIds: [] as string[],
  events: ['ENTRY_PUBLISHED'] as WebhookEventName[],
});
const error = ref<string | null>(null);
const submitting = ref(false);

async function onSubmit() {
  error.value = null;
  submitting.value = true;
  try {
    const res = await $fetch<CreatedWebhook>('/api/webhooks', {
      method: 'POST',
      body: form.value,
    });
    const pendingSecret = useState<string | null>(
      'webhooks:pendingSecret',
      () => null
    );
    pendingSecret.value = res.secret;
    await navigateTo(`/webhooks/${res.id}`);
  } catch (err) {
    error.value = (err as { statusMessage?: string }).statusMessage ?? 'Failed';
  } finally {
    submitting.value = false;
  }
}

function toggleEvent(value: WebhookEventName) {
  if (form.value.events.includes(value)) {
    form.value.events = form.value.events.filter((e) => e !== value);
  } else {
    form.value.events = [...form.value.events, value];
  }
}

function contentTypeName(id: string): string {
  return contentTypes.value?.items.find((c) => c.id === id)?.name ?? id;
}

function addContentType(id: string | null | undefined) {
  if (!id || form.value.contentTypeIds.includes(id)) return;
  form.value.contentTypeIds = [...form.value.contentTypeIds, id];
}

function removeContentType(id: string) {
  form.value.contentTypeIds = form.value.contentTypeIds.filter((c) => c !== id);
}

const availableContentTypes = computed(() =>
  (contentTypes.value?.items ?? [])
    .filter((c) => !form.value.contentTypeIds.includes(c.id))
    .map((c) => ({ label: c.name, value: c.id }))
);
</script>

<template>
  <div class="p-6 max-w-2xl">
    <h1 class="text-2xl font-semibold mb-6">New webhook</h1>

    <UForm :state="form" @submit="onSubmit">
      <UFormField label="Name" name="name" class="mb-4">
        <UInput v-model="form.name" required class="w-full" />
      </UFormField>
      <UFormField
        label="URL"
        name="url"
        class="mb-4"
        help="Must be http(s). Localhost and private ranges are blocked in production."
      >
        <UInput
          v-model="form.url"
          placeholder="https://…"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Content types"
        class="mb-4"
        help="Leave empty to match every content type."
      >
        <div
          class="flex flex-wrap items-center gap-2 min-h-[38px] px-2 py-1 border border-default rounded-md"
        >
          <UBadge
            v-for="ctId in form.contentTypeIds"
            :key="ctId"
            color="primary"
            variant="subtle"
          >
            {{ contentTypeName(ctId) }}
            <button
              type="button"
              class="ml-1 opacity-60 hover:opacity-100"
              @click="removeContentType(ctId)"
            >
              ×
            </button>
          </UBadge>
          <USelect
            :model-value="undefined"
            :items="availableContentTypes"
            value-key="value"
            label-key="label"
            placeholder="Add content type…"
            class="flex-1 border-0"
            @update:model-value="addContentType"
          />
        </div>
      </UFormField>

      <UFormField label="Events" class="mb-4">
        <div class="flex flex-col gap-2">
          <button
            v-for="ev in WEBHOOK_EVENT_OPTIONS"
            :key="ev.value"
            type="button"
            :class="[
              'flex items-start gap-2.5 rounded-md py-3 px-3.5 text-left transition-colors',
              form.events.includes(ev.value)
                ? 'border border-primary bg-primary/5'
                : 'border border-default hover:border-neutral-300 dark:hover:border-neutral-700',
            ]"
            @click="toggleEvent(ev.value)"
          >
            <span
              :class="[
                'shrink-0 mt-0.5 flex items-center justify-center rounded-sm size-4',
                form.events.includes(ev.value)
                  ? 'bg-primary'
                  : 'border-[1.5px] border-neutral-300 dark:border-neutral-600',
              ]"
            >
              <UIcon
                v-if="form.events.includes(ev.value)"
                name="i-lucide-check"
                class="size-3 text-white"
              />
            </span>
            <span class="flex flex-col gap-0.5">
              <span class="text-sm text-default font-medium">{{
                ev.label
              }}</span>
              <span class="text-xs text-muted">{{ ev.description }}</span>
            </span>
          </button>
        </div>
      </UFormField>

      <UFormField class="mb-6">
        <UCheckbox v-model="form.enabled" label="Enabled" />
      </UFormField>

      <UAlert v-if="error" color="error" :title="error" class="mb-4" />
      <div class="flex justify-end gap-2">
        <UButton to="/webhooks" color="neutral" variant="subtle">
          Cancel
        </UButton>
        <UButton type="submit" :loading="submitting">Create webhook</UButton>
      </div>
    </UForm>
  </div>
</template>
