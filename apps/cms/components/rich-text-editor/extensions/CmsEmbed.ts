import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsEmbedNodeView from '../CmsEmbedNodeView.vue';

export interface CmsEmbedAttrs {
  contentTypeId: string | null;
  entryId: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsEmbed: {
      insertCmsEmbed: (attrs: {
        contentTypeId: string;
        entryId: string;
      }) => ReturnType;
    };
  }
}

export const CmsEmbed = Node.create({
  name: 'cmsEmbed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      contentTypeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-content-type-id'),
        renderHTML: (attrs) =>
          attrs.contentTypeId
            ? { 'data-content-type-id': attrs.contentTypeId as string }
            : {},
      },
      entryId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-entry-id'),
        renderHTML: (attrs) =>
          attrs.entryId ? { 'data-entry-id': attrs.entryId as string } : {},
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cms-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-cms-embed': '' })];
  },

  addCommands() {
    return {
      insertCmsEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'cmsEmbed', attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsEmbedNodeView);
  },
});
