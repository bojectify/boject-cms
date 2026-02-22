import { builder } from '../builder';
import { FixtureWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Competition', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    season: t.relation('season', { nullable: true }),
    teams: t.relation('teams'),
    fixtures: t.relation('fixtures', {
      args: { where: t.arg({ type: FixtureWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
