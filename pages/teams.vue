<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { data: teams, status } = await useFetch('/api/teams');

function formatDate(date: string) {
  const d = dayjs(date);
  if (dayjs().diff(d, 'day') < 7) {
    return `${d.fromNow()} at ${d.format('HH:mm')}`;
  }
  return d.format('DD MMM YYYY, HH:mm');
}

type Team = NonNullable<typeof teams.value>[number];

const statusColor: Record<string, 'success' | 'warning' | 'info' | 'neutral'> =
  {
    PUBLISHED: 'success',
    CHANGED: 'warning',
    DRAFT: 'info',
    ARCHIVED: 'neutral',
  };

const columns: TableColumn<Team>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'updatedAt', header: 'Updated' },
];
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold mb-4">Teams</h1>
    <UTable
      :data="teams ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #createdAt-cell="{ row }">
        {{ formatDate(row.original.createdAt) }}
      </template>
      <template #updatedAt-cell="{ row }">
        {{ formatDate(row.original.updatedAt) }}
      </template>
      <template #status-cell="{ row }">
        <UBadge
          :color="statusColor[row.original.status] ?? 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ row.original.status }}
        </UBadge>
      </template>
    </UTable>
  </div>
</template>
