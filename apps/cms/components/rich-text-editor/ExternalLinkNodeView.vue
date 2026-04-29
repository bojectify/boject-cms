<!-- placeholder, replaced in Task 8 -->
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { NodeViewProps } from '@tiptap/core';

defineProps<NodeViewProps>();
</script>
<template>
  <NodeViewWrapper as="span" />
</template>
