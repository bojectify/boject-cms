<script setup lang="ts">
const { data: clubs, status } = await useFetch('/api/clubs');
</script>

<template>
  <ContentTable
    title="Clubs"
    :data="clubs ?? []"
    :loading="status === 'pending'"
  />
</template>
