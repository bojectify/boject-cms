import type { Builder } from '../builder';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerNavigationType(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Navigation', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      items: t.relatedConnection('items', {
        cursor: 'id',
        query: () => ({
          where: { parentId: null },
          orderBy: { order: 'asc' },
        }),
      }),
    }),
  });
}
