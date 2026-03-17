import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsEmbedNode from '~/components/CmsEmbedNode.vue';

export const CmsEmbed = Node.create({
  name: 'cmsEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      embedType: { default: null },
      embedId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-cms-embed]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cms-embed': '' })];
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsEmbedNode);
  },
});
