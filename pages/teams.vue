<script setup lang="ts">
const { data: teams, status } = await useFetch('/api/teams');
</script>

<template>
  <ContentTable
    title="Teams"
    :data="teams ?? []"
    :loading="status === 'pending'"
  />
</template>
