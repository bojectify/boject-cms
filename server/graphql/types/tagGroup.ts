import { builder } from '../builder';
import { TagWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('TagGroup', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    tags: t.relatedConnection('tags', {
      cursor: 'id',
      args: { where: t.arg({ type: TagWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
