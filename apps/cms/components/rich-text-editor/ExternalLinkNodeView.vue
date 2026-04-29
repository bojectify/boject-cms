<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/core';
import { CHIP_EDIT_KEY } from './chipEdit';

const props = defineProps<NodeViewProps>();

const openEdit = inject(CHIP_EDIT_KEY);

const href = computed(() => (props.node.attrs.href as string) ?? '');
const label = computed(() => props.node.attrs.label as string | null);

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url;
  }
}

const display = computed(() => label.value || extractDomain(href.value));

function onClick(event: MouseEvent) {
  event.stopPropagation();
  const pos = props.getPos();
  if (typeof pos !== 'number') return;
  props.editor.commands.setNodeSelection(pos);
  openEdit?.({
    kind: 'externalLink',
    pos,
    attrs: {
      href: href.value,
      label: label.value,
      target: props.node.attrs.target as '_self' | '_blank' | null,
      rel: props.node.attrs.rel as string | null,
    },
  });
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-editor__chip rich-text-editor__chip--external"
    :class="{ 'rich-text-editor__chip--selected': selected }"
    @click="onClick"
  >
    <UIcon name="i-lucide-external-link" class="rich-text-editor__chip-icon" />
    <span class="rich-text-editor__chip-label">{{ display }}</span>
  </NodeViewWrapper>
</template>
