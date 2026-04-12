<script setup lang="ts">
const page = ref(1);
const { data, status } = await useFetch('/api/navigations', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Navigations"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/navigations/' + row.id"
  />
</template>
