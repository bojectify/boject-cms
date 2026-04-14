<script setup lang="ts">
const page = ref(1);

const { data, status } = await useAuthedFetch('/api/competitions', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Competitions"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/competitions/' + row.id"
  >
    <template #actions>
      <UButton to="/competitions/new" icon="i-lucide-plus"
        >New Competition</UButton
      >
    </template>
  </ContentTable>
</template>
