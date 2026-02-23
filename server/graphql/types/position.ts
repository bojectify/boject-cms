import { builder } from '../builder';
import { PlayerWhere } from '../filters';

builder.prismaObject('Position', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    players: t.relatedConnection('players', {
      cursor: 'id',
      args: { where: t.arg({ type: PlayerWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
