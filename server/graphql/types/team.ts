import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerTeamType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Team', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      competitions: t.relatedConnection('competitions', {
        cursor: 'teamId_competitionId',
      }),
      playerHistory: t.relatedConnection('playerHistory', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.PlayerTeamHistoryWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
      fixtures: t.relatedConnection('fixtures', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.FixtureWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
