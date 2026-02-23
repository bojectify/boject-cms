<script setup lang="ts">
const { data: players, status } = await useFetch('/api/players');
</script>

<template>
  <ContentTable
    title="Players"
    :data="players ?? []"
    :loading="status === 'pending'"
  />
</template>
