<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

const props = defineProps(nodeViewProps);

const embedType = computed(() => props.node.attrs.embedType as string);
const embedId = computed(() => props.node.attrs.embedId as string);

const { data: item } = useAuthedFetch<Record<string, unknown>>(
  () => `/api/${embedType.value}s/${embedId.value}`,
  { watch: [embedType, embedId] }
);

const label = computed(() => {
  if (!item.value) return 'Loading...';
  return (
    (item.value.entryTitle as string) ||
    (item.value.name as string) ||
    (item.value.title as string) ||
    embedId.value
  );
});
</script>

<template>
  <NodeViewWrapper
    class="border rounded-lg p-3 my-2 bg-gray-50 dark:bg-gray-900 flex items-center gap-3"
    data-cms-embed
  >
    <UBadge :label="embedType" variant="subtle" size="xs" />
    <span class="font-medium">{{ label }}</span>
    <UButton
      variant="ghost"
      icon="i-lucide-x"
      size="xs"
      class="ml-auto"
      @click="props.deleteNode()"
    />
  </NodeViewWrapper>
</template>
