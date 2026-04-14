import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerAuthorType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('AuthorSocialLink', {
    fields: (t) => ({
      id: t.exposeID('id'),
      platform: t.exposeString('platform'),
      url: t.exposeString('url'),
    }),
  });

  builder.prismaObject('Author', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      bio: t.exposeString('bio', { nullable: true }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      headshot: t.relation('headshot', { nullable: true }),
      socialLinks: t.relation('socialLinks'),
      articles: t.relatedConnection('articles', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.ArticleWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
