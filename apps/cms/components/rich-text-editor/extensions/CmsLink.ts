import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsLinkNodeView from '../CmsLinkNodeView.vue';

export interface CmsLinkAttrs {
  contentTypeId: string | null;
  entryId: string | null;
  contentTypeIdentifier: string | null;
  label: string | null;
  target: '_self' | '_blank' | null;
  rel: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsLink: {
      insertCmsLink: (attrs: {
        contentTypeId: string;
        entryId: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | null;
      }) => ReturnType;
    };
  }
}

export const CmsLink = Node.create({
  name: 'cmsLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

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
      contentTypeIdentifier: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-content-type-identifier'),
        renderHTML: (attrs) =>
          attrs.contentTypeIdentifier
            ? {
                'data-content-type-identifier':
                  attrs.contentTypeIdentifier as string,
              }
            : {},
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label as string } : {},
      },
      target: {
        default: null,
        parseHTML: (el) => el.getAttribute('target'),
        renderHTML: (attrs) =>
          attrs.target ? { target: attrs.target as string } : {},
      },
      rel: {
        default: null,
        parseHTML: (el) => el.getAttribute('rel'),
        renderHTML: (attrs) => (attrs.rel ? { rel: attrs.rel as string } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-cms-link]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const contentTypeId = el.getAttribute('data-content-type-id');
          const entryId = el.getAttribute('data-entry-id');
          if (!contentTypeId || !entryId) return false;
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-cms-link': '' })];
  },

  addCommands() {
    return {
      insertCmsLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsLinkNodeView);
  },
});
