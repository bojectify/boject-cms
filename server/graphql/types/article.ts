import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerArticleType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  const ArticleRef = builder.prismaObject('Article', {
    fields: (t) => ({
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      slug: t.exposeString('slug'),
      summary: t.exposeString('summary', { nullable: true }),
      body: t.expose('body', { type: 'JSON', nullable: true }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      author: t.relation('author', { nullable: true }),
      featuredImage: t.relation('featuredImage', { nullable: true }),
      tags: t.relatedConnection('tags', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.TagWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });

  return { ArticleRef };
}
