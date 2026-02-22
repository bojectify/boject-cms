<script setup lang="ts">
const { data: teams, status } = await useFetch('/api/teams');

const columns = [
  { accessorKey: 'name', header: 'Name' },
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
    />
  </div>
</template>
