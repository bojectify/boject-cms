import { builder } from '../builder';
import { TagWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Article', {
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    slug: t.exposeString('slug'),
    summary: t.exposeString('summary', { nullable: true }),
    body: t.expose('body', { type: 'JSON', nullable: true }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    author: t.relation('author', { nullable: true }),
    featuredImage: t.relation('featuredImage', { nullable: true }),
    tags: t.relatedConnection('tags', {
      cursor: 'id',
      args: { where: t.arg({ type: TagWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
