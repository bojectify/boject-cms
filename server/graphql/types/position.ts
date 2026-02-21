import { builder } from '../builder';

builder.prismaObject('Position', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    players: t.relation('players'),
  }),
});


export const _registered = true;