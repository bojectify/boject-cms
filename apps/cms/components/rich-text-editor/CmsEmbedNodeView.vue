<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/core';
import { CHIP_EDIT_KEY } from './chipEdit';

const props = defineProps<NodeViewProps>();

const openEdit = inject(CHIP_EDIT_KEY);

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

const label = computed(() => props.node.attrs.label as string | null);
const display = computed(() => label.value || resolved.value?.entryTitle || '');

function onClick(event: MouseEvent) {
  event.stopPropagation();
  const contentTypeId = props.node.attrs.contentTypeId as string | null;
  const entryId = props.node.attrs.entryId as string | null;
  if (!contentTypeId || !entryId) return;
  const pos = props.getPos();
  if (typeof pos !== 'number') return;
  props.editor.commands.setNodeSelection(pos);
  openEdit?.({
    kind: 'cmsEmbed',
    pos,
    attrs: {
      contentTypeId,
      entryId,
      label: label.value,
    },
  });
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-editor__chip rich-text-editor__chip--embed"
    :class="{ 'rich-text-editor__chip--selected': selected }"
    @click="onClick"
  >
    <UIcon name="i-lucide-at-sign" class="rich-text-editor__chip-icon" />
    <template v-if="missing">
      <span class="rich-text-editor__chip-label italic text-muted">
        Missing entry
      </span>
    </template>
    <template v-else-if="resolved">
      <span class="rich-text-editor__chip-label">{{ display }}</span>
    </template>
    <template v-else>
      <span class="rich-text-editor__chip-label text-muted">Loading…</span>
    </template>
  </NodeViewWrapper>
</template>
