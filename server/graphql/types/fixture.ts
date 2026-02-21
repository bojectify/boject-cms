import { builder } from '../builder';

builder.prismaObject('Fixture', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    isHome: t.exposeBoolean('isHome'),
    kickoff: t.expose('kickoff', { type: 'String' }),
    venue: t.exposeString('venue'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    competition: t.relation('competition', { nullable: true }),
    season: t.relation('season', { nullable: true }),
    team: t.relation('team', { nullable: true }),
    opponent: t.relation('opponent', { nullable: true }),
    scores: t.relation('scores'),
  }),
});


export const _registered = true;