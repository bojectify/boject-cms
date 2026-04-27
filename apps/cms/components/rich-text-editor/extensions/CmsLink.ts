import { Mark, mergeAttributes } from '@tiptap/core';

export interface CmsLinkAttrs {
  contentTypeId: string | null;
  entryId: string | null;
  contentTypeIdentifier: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsLink: {
      setCmsLink: (attrs: {
        contentTypeId: string;
        entryId: string;
      }) => ReturnType;
      unsetCmsLink: () => ReturnType;
    };
  }
}

export const CmsLink = Mark.create({
  name: 'cmsLink',
  inclusive: false,
  exitable: true,

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
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-cms-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-cms-link': '',
        class: 'cms-link',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCmsLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetCmsLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
