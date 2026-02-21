import { builder } from '../builder';

builder.prismaObject('Team', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    competitions: t.relation('competitions'),
    playerHistory: t.relation('playerHistory'),
    fixtures: t.relation('fixtures'),
  }),
});


export const _registered = true;