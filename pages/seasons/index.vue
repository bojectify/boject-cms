<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/seasons', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Seasons"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/seasons/' + row.id"
  >
    <template #actions>
      <UButton to="/seasons/new" icon="i-lucide-plus">New Season</UButton>
    </template>
  </ContentTable>
</template>
