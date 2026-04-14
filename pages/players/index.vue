<script setup lang="ts">
const page = ref(1);

const { data, status } = await useAuthedFetch('/api/players', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Players"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/players/' + row.id"
  >
    <template #actions>
      <UButton to="/players/new" icon="i-lucide-plus">New Player</UButton>
    </template>
  </ContentTable>
</template>
