import { builder } from '../builder';

builder.prismaObject('TeamsOnCompetitions', {
  fields: (t) => ({
    teamId: t.exposeString('teamId'),
    competitionId: t.exposeString('competitionId'),
    team: t.relation('team'),
    competition: t.relation('competition'),
  }),
});

export const _registered = true;
