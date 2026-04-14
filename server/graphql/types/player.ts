import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerPlayerType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Player', {
    fields: (t) => ({
      id: t.exposeID('id'),
      firstName: t.exposeString('firstName'),
      lastName: t.exposeString('lastName'),
      slug: t.exposeString('slug'),
      bio: t.exposeString('bio', { nullable: true }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      position: t.relation('position', { nullable: true }),
      headshot: t.relation('headshot', { nullable: true }),
      actionShot: t.relation('actionShot', { nullable: true }),
      teamHistory: t.relatedConnection('teamHistory', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.PlayerTeamHistoryWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
      scores: t.relatedConnection('scores', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.ScoreWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
