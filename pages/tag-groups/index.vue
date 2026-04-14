<script setup lang="ts">
const page = ref(1);

const { data, status } = await useAuthedFetch('/api/tag-groups', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Tag Groups"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/tag-groups/' + row.id"
  >
    <template #actions>
      <UButton to="/tag-groups/new" icon="i-lucide-plus">New Tag Group</UButton>
    </template>
  </ContentTable>
</template>
