import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ExternalLinkNodeView from '../ExternalLinkNodeView.vue';

export interface ExternalLinkAttrs {
  href: string;
  label: string | null;
  target: '_self' | '_blank' | null;
  rel: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    externalLink: {
      insertExternalLink: (attrs: {
        href: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | null;
      }) => ReturnType;
    };
  }
}

export const ExternalLink = Node.create({
  name: 'externalLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (el) => el.getAttribute('href') ?? '',
        renderHTML: (attrs) =>
          attrs.href ? { href: attrs.href as string } : {},
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
    return [{ tag: 'a[data-external-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-external-link': '' })];
  },

  addCommands() {
    return {
      insertExternalLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(ExternalLinkNodeView);
  },
});
