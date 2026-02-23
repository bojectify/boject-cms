<script setup lang="ts">
const { data: seasons, status } = await useFetch('/api/seasons');
</script>

<template>
  <ContentTable
    title="Seasons"
    :data="seasons ?? []"
    :loading="status === 'pending'"
  />
</template>
