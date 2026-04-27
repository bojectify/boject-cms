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
      contentTypeId: { default: null },
      entryId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-cms-embed]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            contentTypeId: el.getAttribute('data-content-type-id'),
            entryId: el.getAttribute('data-entry-id'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-cms-embed': '',
        'data-content-type-id': HTMLAttributes.contentTypeId ?? '',
        'data-entry-id': HTMLAttributes.entryId ?? '',
      }),
    ];
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
