<script setup lang="ts">
const { data: images, status } = await useFetch('/api/images');
</script>

<template>
  <ContentTable
    title="Images"
    :data="images ?? []"
    :loading="status === 'pending'"
  />
</template>
