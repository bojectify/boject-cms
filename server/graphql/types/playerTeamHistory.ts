import { builder } from '../builder';

builder.prismaObject('PlayerTeamHistory', {
  fields: (t) => ({
    id: t.exposeID('id'),
    startDate: t.expose('startDate', { type: 'String' }),
    endDate: t.expose('endDate', { type: 'String', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    player: t.relation('player'),
    team: t.relation('team'),
  }),
});


export const _registered = true;