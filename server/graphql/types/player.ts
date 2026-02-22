import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Player', {
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    bio: t.exposeString('bio', { nullable: true }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    position: t.relation('position', { nullable: true }),
    headshot: t.relation('headshot', { nullable: true }),
    actionShot: t.relation('actionShot', { nullable: true }),
    teamHistory: t.relation('teamHistory'),
    scores: t.relation('scores'),
  }),
});

export const _registered = true;
