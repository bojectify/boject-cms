import { builder } from '../builder';
import { ArticleWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Tag', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    articles: t.relatedConnection('articles', {
      cursor: 'id',
      args: { where: t.arg({ type: ArticleWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
