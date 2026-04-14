import type { Builder } from '../builder';

export function registerPlayerTeamHistoryType(builder: Builder) {
  builder.prismaObject('PlayerTeamHistory', {
    fields: (t) => ({
      id: t.exposeID('id'),
      startDate: t.expose('startDate', { type: 'DateTime' }),
      endDate: t.expose('endDate', { type: 'DateTime', nullable: true }),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      player: t.relation('player'),
      team: t.relation('team'),
    }),
  });
}
