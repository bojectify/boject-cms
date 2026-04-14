import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerCompetitionType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Competition', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      season: t.relation('season', { nullable: true }),
      teams: t.relatedConnection('teams', {
        cursor: 'teamId_competitionId',
      }),
      fixtures: t.relatedConnection('fixtures', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.FixtureWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
