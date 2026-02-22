import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Fixture', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    isHome: t.exposeBoolean('isHome'),
    kickoff: t.expose('kickoff', { type: 'DateTime' }),
    venue: t.exposeString('venue'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    competition: t.relation('competition', { nullable: true }),
    season: t.relation('season', { nullable: true }),
    team: t.relation('team', { nullable: true }),
    opponent: t.relation('opponent', { nullable: true }),
    scores: t.relation('scores'),
  }),
});

export const _registered = true;
