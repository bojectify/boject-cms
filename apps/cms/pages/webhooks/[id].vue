<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

interface Webhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  contentTypeIds: string[];
  events: string[];
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  id: string;
  event: string;
  entryId: string;
  status: string;
  attempts: number;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
  lastError: string | null;
  isTest: boolean;
  createdAt: string;
  completedAt: string | null;
  payload: unknown;
}

const route = useRoute();
const id = route.params.id as string;

const { data, refresh } = await useAuthedFetch<Webhook>(`/api/webhooks/${id}`);
const { data: deliveriesData, refresh: refreshDeliveries } =
  await useAuthedFetch<{
    items: Delivery[];
  }>(`/api/webhooks/${id}/deliveries?perPage=100`);

const { data: contentTypes } = await useAuthedFetch<{
  items: Array<{ id: string; name: string }>;
}>('/api/content-types');

const rotatedSecret = ref<string | null>(null);
const saving = ref(false);
const expanded = ref<string | null>(null);

async function save() {
  if (!data.value) return;
  saving.value = true;
  await $fetch(`/api/webhooks/${id}`, {
    method: 'PUT',
    body: {
      name: data.value.name,
      url: data.value.url,
      enabled: data.value.enabled,
      events: data.value.events,
      contentTypeIds: data.value.contentTypeIds,
    },
  });
  saving.value = false;
  await refresh();
}

async function rotate() {
  if (
    !confirm('Rotate the secret? The old secret will stop working immediately.')
  )
    return;
  const res = await $fetch<{ secret: string }>(`/api/webhooks/${id}/rotate`, {
    method: 'POST',
  });
  rotatedSecret.value = res.secret;
}

async function sendTest() {
  await $fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
  await refreshDeliveries();
}

async function retry(deliveryId: string) {
  await $fetch(`/api/webhooks/deliveries/${deliveryId}/retry`, {
    method: 'POST',
  });
  await refreshDeliveries();
}

async function cancel(deliveryId: string) {
  if (!confirm('Cancel this pending retry? It will not be attempted again.'))
    return;
  await $fetch(`/api/webhooks/deliveries/${deliveryId}/cancel`, {
    method: 'POST',
  });
  await refreshDeliveries();
}

async function deleteWebhook() {
  if (!confirm('Delete this webhook and its delivery log?')) return;
  await $fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
  navigateTo('/webhooks');
}

const EVENTS = ['ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED'];
const statusColor = (s: string) =>
  s === 'SUCCESS'
    ? 'success'
    : s === 'FAILED'
      ? 'error'
      : s === 'DEAD_LETTERED'
        ? 'error'
        : 'neutral';
</script>

<template>
  <div v-if="data" class="p-6 max-w-4xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">{{ data.name }}</h1>
      <div class="flex gap-2">
        <UButton variant="subtle" @click="sendTest">Send test payload</UButton>
        <UButton variant="subtle" color="warning" @click="rotate">
          Rotate secret
        </UButton>
      </div>
    </div>

    <WebhookSecretReveal
      v-if="rotatedSecret"
      :secret="rotatedSecret"
      class="mb-6"
    />

    <UForm :state="data" class="mb-10" @submit="save">
      <UFormField label="Name" class="mb-4">
        <UInput v-model="data.name" class="w-full" />
      </UFormField>
      <UFormField label="URL" class="mb-4">
        <UInput v-model="data.url" class="w-full" />
      </UFormField>
      <UFormField label="Content types" class="mb-4">
        <USelectMenu
          v-model="data.contentTypeIds"
          multiple
          :items="
            (contentTypes?.items ?? []).map((c) => ({
              label: c.name,
              value: c.id,
            }))
          "
          value-key="value"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Events" class="mb-4">
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-for="ev in EVENTS"
            :key="ev"
            :model-value="data.events.includes(ev)"
            :label="ev"
            @update:model-value="
              (v) => {
                data!.events = v
                  ? [...data!.events, ev]
                  : data!.events.filter((e) => e !== ev);
              }
            "
          />
        </div>
      </UFormField>
      <UFormField class="mb-6">
        <UCheckbox v-model="data.enabled" label="Enabled" />
      </UFormField>
      <UButton type="submit" :loading="saving">Save changes</UButton>
    </UForm>

    <h2 class="text-xl font-semibold mb-3">Delivery log</h2>
    <UTable
      :data="deliveriesData?.items ?? []"
      :columns="[
        { accessorKey: 'createdAt', header: 'When' },
        { accessorKey: 'event', header: 'Event' },
        { accessorKey: 'status', header: 'Status' },
        { accessorKey: 'attempts', header: 'Attempts' },
        { accessorKey: 'actions', header: '' },
      ]"
    >
      <template #createdAt-cell="{ row }">
        <time :title="row.original.createdAt">{{
          new Date(row.original.createdAt).toLocaleString()
        }}</time>
      </template>
      <template #status-cell="{ row }">
        <UBadge :color="statusColor(row.original.status)">{{
          row.original.status
        }}</UBadge>
        <UBadge v-if="row.original.isTest" color="info" class="ml-1">
          TEST
        </UBadge>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            size="xs"
            variant="ghost"
            @click="
              expanded = expanded === row.original.id ? null : row.original.id
            "
          >
            {{ expanded === row.original.id ? 'Hide' : 'Show' }}
          </UButton>
          <UButton
            v-if="
              row.original.status === 'FAILED' ||
              row.original.status === 'DEAD_LETTERED'
            "
            size="xs"
            variant="subtle"
            @click="retry(row.original.id)"
          >
            Retry
          </UButton>
          <UButton
            v-if="
              row.original.status === 'PENDING' && row.original.attempts > 0
            "
            size="xs"
            variant="subtle"
            color="warning"
            @click="cancel(row.original.id)"
          >
            Cancel
          </UButton>
        </div>
      </template>
    </UTable>

    <div
      v-for="d in deliveriesData?.items ?? []"
      v-show="expanded === d.id"
      :key="d.id"
      class="mt-4 border rounded p-4 text-xs"
    >
      <div class="font-semibold mb-1">Response</div>
      <pre class="mb-3"
        >{{ d.lastResponseCode ?? 'no response' }} {{
          d.lastError ?? d.lastResponseBody ?? ''
        }}</pre
      >
      <div class="font-semibold mb-1">Payload</div>
      <pre>{{ JSON.stringify(d.payload, null, 2) }}</pre>
    </div>

    <div class="mt-12 border-t pt-6">
      <h2
        class="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 mb-2"
      >
        Danger zone
      </h2>
      <UButton color="error" variant="subtle" @click="deleteWebhook">
        Delete webhook
      </UButton>
    </div>
  </div>
</template>
