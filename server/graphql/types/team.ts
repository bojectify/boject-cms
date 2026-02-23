import { builder } from '../builder';
import { FixtureWhere, PlayerTeamHistoryWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Team', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    competitions: t.relation('competitions'),
    playerHistory: t.relation('playerHistory', {
      args: { where: t.arg({ type: PlayerTeamHistoryWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
    fixtures: t.relation('fixtures', {
      args: { where: t.arg({ type: FixtureWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
