import { builder } from '../builder';

builder.prismaObject('Player', {
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    bio: t.exposeString('bio', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    position: t.relation('position', { nullable: true }),
    headshot: t.relation('headshot', { nullable: true }),
    actionShot: t.relation('actionShot', { nullable: true }),
    teamHistory: t.relation('teamHistory'),
    scores: t.relation('scores'),
  }),
});


export const _registered = true;