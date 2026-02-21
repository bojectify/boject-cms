import { builder } from '../builder';

builder.prismaObject('Team', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    competitions: t.relation('competitions'),
    playerHistory: t.relation('playerHistory'),
    fixtures: t.relation('fixtures'),
  }),
});

export const _registered = true;
