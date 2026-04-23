<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
  lastRequestHeaders: Record<string, string> | null;
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

// `deep: true` is required: Nuxt 4 defaults to a shallowRef, so nested
// mutations like `data.value.enabled = true` or edits to `data.value.events`
// from the form UI would not trigger re-renders.
const { data, refresh } = await useAuthedFetch<Webhook>(`/api/webhooks/${id}`, {
  deep: true,
});
const { data: deliveriesData, refresh: refreshDeliveries } =
  await useAuthedFetch<{
    items: Delivery[];
  }>(`/api/webhooks/${id}/deliveries?perPage=100`);

const { data: contentTypes } = await useAuthedFetch<{
  items: Array<{ id: string; name: string }>;
}>('/api/content-types');

const pendingSecret = useState<string | null>(
  'webhooks:pendingSecret',
  () => null
);
const rotatedSecret = ref<string | null>(pendingSecret.value);
if (pendingSecret.value) {
  pendingSecret.value = null;
}
const saving = ref(false);

type DeliveryFilter = 'all' | 'success' | 'failed' | 'dead-lettered';
const deliveryFilter = ref<DeliveryFilter>('all');
const deliveryFilterOptions: Array<{ value: DeliveryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead-lettered', label: 'Dead-lettered' },
];
const filteredDeliveries = computed(() => {
  const items = deliveriesData.value?.items ?? [];
  switch (deliveryFilter.value) {
    case 'success':
      return items.filter((d) => d.status === 'SUCCESS');
    case 'failed':
      return items.filter((d) => d.status === 'FAILED');
    case 'dead-lettered':
      return items.filter((d) => d.status === 'DEAD_LETTERED');
    default:
      return items;
  }
});

// Live-update the delivery log while retries are in flight: poll every
// POLL_INTERVAL_MS whenever any row is PENDING and the tab is visible. The
// worker polls its queue every 1s, so 2.5s here gives a 2.5–3.5s perceived
// lag between a retry firing and the UI catching up.
const POLL_INTERVAL_MS = 2500;
const hasPending = computed(() =>
  (deliveriesData.value?.items ?? []).some((d) => d.status === 'PENDING')
);
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshDeliveries();
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && hasPending.value) {
    refreshDeliveries();
  }
}

onMounted(() => {
  watch(
    hasPending,
    (pending) => {
      if (pending) startPolling();
      else stopPolling();
    },
    { immediate: true }
  );
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  stopPolling();
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
});

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

interface EventOption {
  value: 'ENTRY_PUBLISHED' | 'ENTRY_UNPUBLISHED' | 'ENTRY_DELETED';
  label: string;
  description: string;
}

const EVENTS: EventOption[] = [
  {
    value: 'ENTRY_PUBLISHED',
    label: 'Entry published',
    description:
      'Fires whenever an entry is first published or a change is republished.',
  },
  {
    value: 'ENTRY_DELETED',
    label: 'Entry deleted',
    description: 'Fires when a previously-published entry is deleted.',
  },
  {
    value: 'ENTRY_UNPUBLISHED',
    label: 'Entry unpublished',
    description:
      'Fires when an entry is demoted from published (via Unpublish or Archive).',
  },
];

function toggleEvent(value: EventOption['value']) {
  if (!data.value) return;
  if (data.value.events.includes(value)) {
    data.value.events = data.value.events.filter((e) => e !== value);
  } else {
    data.value.events = [...data.value.events, value];
  }
}

function contentTypeName(id: string): string {
  return contentTypes.value?.items.find((c) => c.id === id)?.name ?? id;
}

function addContentType(id: string | null | undefined) {
  if (!id || !data.value) return;
  if (data.value.contentTypeIds.includes(id)) return;
  data.value.contentTypeIds = [...data.value.contentTypeIds, id];
}

function removeContentType(id: string) {
  if (!data.value) return;
  data.value.contentTypeIds = data.value.contentTypeIds.filter((c) => c !== id);
}

const availableContentTypes = computed(() =>
  (contentTypes.value?.items ?? [])
    .filter((c) => !(data.value?.contentTypeIds ?? []).includes(c.id))
    .map((c) => ({ label: c.name, value: c.id }))
);

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function formatResponseBody(body: string | null): string {
  if (!body) return '';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

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
  <div v-if="data" class="p-6 max-w-6xl">
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
        <div
          class="flex flex-wrap items-center gap-2 min-h-[38px] px-2 py-1 border border-default rounded-md"
        >
          <UBadge
            v-for="ctId in data.contentTypeIds"
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
            v-for="ev in EVENTS"
            :key="ev.value"
            type="button"
            :class="[
              'flex items-start gap-2.5 rounded-md py-3 px-3.5 text-left transition-colors',
              data.events.includes(ev.value)
                ? 'border border-primary bg-primary/5'
                : 'border border-default hover:border-neutral-300 dark:hover:border-neutral-700',
            ]"
            @click="toggleEvent(ev.value)"
          >
            <span
              :class="[
                'shrink-0 mt-0.5 flex items-center justify-center rounded-sm size-4',
                data.events.includes(ev.value)
                  ? 'bg-primary'
                  : 'border-[1.5px] border-neutral-300 dark:border-neutral-600',
              ]"
            >
              <UIcon
                v-if="data.events.includes(ev.value)"
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
        <USwitch v-model="data.enabled" label="Enabled" />
      </UFormField>
      <UButton type="submit" :loading="saving">Save changes</UButton>
    </UForm>

    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xl font-semibold">Delivery log</h2>
      <UButtonGroup>
        <UButton
          v-for="opt in deliveryFilterOptions"
          :key="opt.value"
          :color="deliveryFilter === opt.value ? 'primary' : 'neutral'"
          :variant="deliveryFilter === opt.value ? 'solid' : 'outline'"
          size="sm"
          @click="deliveryFilter = opt.value"
        >
          {{ opt.label }}
        </UButton>
      </UButtonGroup>
    </div>
    <UTable
      :data="filteredDeliveries"
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
          <UButton size="xs" variant="ghost" @click="row.toggleExpanded()">
            {{ row.getIsExpanded() ? 'Hide' : 'Show' }}
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
      <template #expanded="{ row }">
        <div class="p-4 text-xs">
          <div class="font-semibold mb-1">Response</div>
          <div class="mb-3">
            <div class="mb-1">
              {{ row.original.lastResponseCode ?? 'no response' }}
            </div>
            <pre
              v-if="row.original.lastError || row.original.lastResponseBody"
              class="whitespace-pre-wrap wrap-anywhere"
              >{{
                row.original.lastError ??
                formatResponseBody(row.original.lastResponseBody)
              }}</pre
            >
          </div>
          <div v-if="row.original.lastRequestHeaders" class="mb-3">
            <div class="font-semibold mb-1">Request headers</div>
            <pre class="whitespace-pre-wrap wrap-anywhere">{{
              formatHeaders(row.original.lastRequestHeaders)
            }}</pre>
          </div>
          <div class="font-semibold mb-1">Payload</div>
          <pre class="whitespace-pre-wrap wrap-anywhere">{{
            JSON.stringify(row.original.payload, null, 2)
          }}</pre>
        </div>
      </template>
    </UTable>

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
