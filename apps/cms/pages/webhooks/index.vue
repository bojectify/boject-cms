<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

interface WebhookListItem {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  contentTypeIds: string[];
  events: string[];
  createdAt: string;
  updatedAt: string;
}

const { data, status } = await useAuthedFetch<{ items: WebhookListItem[] }>(
  '/api/webhooks'
);

const columns: TableColumn<WebhookListItem>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'url', header: 'URL' },
  { accessorKey: 'events', header: 'Events' },
  { accessorKey: 'enabled', header: 'Status' },
];
</script>

<template>
  <div class="p-6">
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Webhooks</h1>
        <p class="text-sm text-muted mt-1">
          Notify external systems when content is published or deleted.
        </p>
      </div>
      <UButton to="/webhooks/new" icon="i-lucide-plus">New webhook</UButton>
    </div>

    <UTable
      :data="data?.items ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #name-cell="{ row }">
        <NuxtLink
          :to="`/webhooks/${row.original.id}`"
          class="text-primary hover:underline font-medium"
        >
          {{ row.original.name }}
        </NuxtLink>
      </template>
      <template #url-cell="{ row }">
        <code class="text-xs break-all">{{ row.original.url }}</code>
      </template>
      <template #events-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <UBadge
            v-for="e in row.original.events"
            :key="e"
            color="primary"
            variant="subtle"
            size="sm"
          >
            {{ e }}
          </UBadge>
        </div>
      </template>
      <template #enabled-cell="{ row }">
        <UBadge
          :color="row.original.enabled ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ row.original.enabled ? 'Enabled' : 'Disabled' }}
        </UBadge>
      </template>
    </UTable>
  </div>
</template>
