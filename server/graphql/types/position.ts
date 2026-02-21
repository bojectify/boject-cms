import { builder } from '../builder';

builder.prismaObject('Position', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    players: t.relation('players'),
  }),
});

export const _registered = true;
