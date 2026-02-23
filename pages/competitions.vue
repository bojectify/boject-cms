<script setup lang="ts">
const { data: competitions, status } = await useFetch('/api/competitions');
</script>

<template>
  <ContentTable
    title="Competitions"
    :data="competitions ?? []"
    :loading="status === 'pending'"
  />
</template>
