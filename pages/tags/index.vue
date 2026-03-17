<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/tags', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Tags"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/tags/' + row.id"
  />
</template>
