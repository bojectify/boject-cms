import type { Builder } from '../builder';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';
import { prisma } from '../../utils/prisma';

type ArticleRef = ReturnType<
  typeof import('./article').registerArticleType
>['ArticleRef'];

export function registerLinkType(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef,
  ArticleRef: ArticleRef
) {
  const LinkTarget = builder.unionType('LinkTarget', {
    types: [ArticleRef],
    resolveType: () => {
      // All current union members are Articles.
      // When adding new types, check for a discriminating field.
      return ArticleRef;
    },
  });

  builder.prismaObject('Link', {
    fields: (t) => ({
      id: t.exposeID('id'),
      label: t.exposeString('label'),
      url: t.exposeString('url', { nullable: true }),
      openInNewTab: t.exposeBoolean('openInNewTab'),
      article: t.relation('article', { nullable: true }),
      internalLink: t.field({
        type: LinkTarget,
        nullable: true,
        resolve: async (link) => {
          if (link.articleId) {
            return prisma.article.findUnique({
              where: { id: link.articleId },
            });
          }
          return null;
        },
      }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    }),
  });
}
