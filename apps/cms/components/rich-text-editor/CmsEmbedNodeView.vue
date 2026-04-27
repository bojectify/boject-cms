<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/core';

const props = defineProps<NodeViewProps>();

const { resolveRef } = useRelationResolver();

const resolved = ref<{
  entryTitle: string;
  contentTypeName: string;
} | null>(null);
const missing = ref(false);

let lastAttempt = 0;

async function load() {
  const attempt = ++lastAttempt;
  const contentTypeId = props.node.attrs.contentTypeId as string | null;
  const entryId = props.node.attrs.entryId as string | null;
  if (!contentTypeId || !entryId) {
    if (attempt === lastAttempt) {
      missing.value = true;
      resolved.value = null;
    }
    return;
  }
  try {
    const r = await resolveRef({ contentTypeId, entryId });
    if (attempt !== lastAttempt) return;
    resolved.value = {
      entryTitle: r.entryTitle,
      contentTypeName: r.contentTypeName,
    };
    missing.value = false;
  } catch (err) {
    if (attempt !== lastAttempt) return;
    console.error('Failed to resolve cmsEmbed reference', err);
    missing.value = true;
    resolved.value = null;
  }
}

watch(
  () => [props.node.attrs.contentTypeId, props.node.attrs.entryId],
  () => {
    void load();
  },
  { immediate: true }
);
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm align-baseline cursor-default"
  >
    <template v-if="missing">
      <UIcon name="i-lucide-link-2-off" class="size-3 text-red-500" />
      <span class="italic text-muted">(deleted)</span>
    </template>
    <template v-else-if="resolved">
      <UBadge
        size="sm"
        color="neutral"
        variant="subtle"
        class="text-[10px] px-1"
      >
        {{ resolved.contentTypeName }}
      </UBadge>
      <span>{{ resolved.entryTitle }}</span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-loader-2" class="size-3 animate-spin text-muted" />
    </template>
  </NodeViewWrapper>
</template>
