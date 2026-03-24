<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/clubs', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Clubs"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/clubs/' + row.id"
  >
    <template #actions>
      <UButton to="/clubs/new" icon="i-lucide-plus">New Club</UButton>
    </template>
  </ContentTable>
</template>
