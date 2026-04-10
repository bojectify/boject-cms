import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Navigation', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    ...contentMetadataFields(t),
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

export const _registered = true;
