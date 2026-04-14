<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

const page = ref(1);

const { data, status } = await useAuthedFetch('/api/articles', {
  query: { page, perPage: 15 },
  watch: [page],
});

const extraColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'author', header: 'Author' },
  { accessorKey: 'tags', header: 'Tags' },
];

function getAuthorName(row: Record<string, unknown>): string {
  const author = row.author as Record<string, unknown> | null | undefined;
  return (author?.name as string) ?? '—';
}

function getTagNames(row: Record<string, unknown>): string {
  const tags = row.tags as Array<{ name: string }> | null | undefined;
  return tags?.map((t) => t.name).join(', ') || '—';
}
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Articles"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :columns="extraColumns"
    :row-link="(row) => '/articles/' + row.id"
  >
    <template #actions>
      <UButton to="/articles/new" icon="i-lucide-plus">New Article</UButton>
    </template>
    <template #author-cell="{ row }">
      {{ getAuthorName(row.original) }}
    </template>
    <template #tags-cell="{ row }">
      {{ getTagNames(row.original) }}
    </template>
  </ContentTable>
</template>
