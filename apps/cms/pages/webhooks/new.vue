<script setup lang="ts">
import { ref } from 'vue';

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
  events: ['ENTRY_PUBLISHED'] as string[],
});
const created = ref<CreatedWebhook | null>(null);
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
    created.value = res;
  } catch (err) {
    error.value = (err as { statusMessage?: string }).statusMessage ?? 'Failed';
  } finally {
    submitting.value = false;
  }
}

const EVENTS = [
  { value: 'ENTRY_PUBLISHED', label: 'Entry published' },
  { value: 'ENTRY_UNPUBLISHED', label: 'Entry unpublished' },
  { value: 'ENTRY_DELETED', label: 'Entry deleted' },
];
</script>

<template>
  <div class="p-6 max-w-2xl">
    <h1 class="text-2xl font-semibold mb-6">New webhook</h1>

    <WebhookSecretReveal v-if="created" :secret="created.secret" />
    <div v-if="created" class="mb-6">
      <UButton :to="`/webhooks/${created.id}`">Go to webhook</UButton>
    </div>

    <UForm v-if="!created" :state="form" @submit="onSubmit">
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
        <USelectMenu
          v-model="form.contentTypeIds"
          multiple
          :items="
            (contentTypes?.items ?? []).map((c) => ({
              label: c.name,
              value: c.id,
            }))
          "
          value-key="value"
          placeholder="All content types"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Events" class="mb-4">
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-for="ev in EVENTS"
            :key="ev.value"
            :model-value="form.events.includes(ev.value)"
            :label="ev.label"
            @update:model-value="
              (v) => {
                form.events = v
                  ? [...form.events, ev.value]
                  : form.events.filter((e) => e !== ev.value);
              }
            "
          />
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
