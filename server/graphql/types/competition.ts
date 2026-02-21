import { builder } from '../builder';

builder.prismaObject('Competition', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    season: t.relation('season', { nullable: true }),
    teams: t.relation('teams'),
    fixtures: t.relation('fixtures'),
  }),
});


export const _registered = true;