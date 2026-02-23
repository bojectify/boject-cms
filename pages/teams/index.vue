<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/teams', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Teams"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/teams/' + row.id"
  />
</template>
