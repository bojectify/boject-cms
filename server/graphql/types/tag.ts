import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerTagType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Tag', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      group: t.relation('group', { nullable: true }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      articles: t.relatedConnection('articles', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.ArticleWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
