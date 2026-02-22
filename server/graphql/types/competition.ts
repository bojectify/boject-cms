import { builder } from '../builder';
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
    fixtures: t.relation('fixtures'),
  }),
});

export const _registered = true;
