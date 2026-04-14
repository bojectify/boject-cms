import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerFixtureType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Fixture', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      isHome: t.exposeBoolean('isHome'),
      kickoff: t.expose('kickoff', { type: 'DateTime' }),
      venue: t.exposeString('venue'),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      competition: t.relation('competition', { nullable: true }),
      season: t.relation('season', { nullable: true }),
      team: t.relation('team', { nullable: true }),
      opponent: t.relation('opponent', { nullable: true }),
      scores: t.relatedConnection('scores', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.ScoreWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
