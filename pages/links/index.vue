<script setup lang="ts">
const page = ref(1);
const { data, status } = await useAuthedFetch('/api/links', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Links"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/links/' + row.id"
  >
    <template #actions>
      <UButton to="/links/new" icon="i-lucide-plus">New Link</UButton>
    </template>
  </ContentTable>
</template>
