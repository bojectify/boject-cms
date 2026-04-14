import type { Builder } from '../builder';

export function registerTeamsOnCompetitionsType(builder: Builder) {
  builder.prismaObject('TeamsOnCompetitions', {
    fields: (t) => ({
      teamId: t.exposeString('teamId'),
      competitionId: t.exposeString('competitionId'),
      team: t.relation('team'),
      competition: t.relation('competition'),
    }),
  });
}
