import type { Builder } from '../builder';

export function registerScoreTypes(builder: Builder) {
  const ScoreTypeEnum = builder.enumType('ScoreType', {
    values: ['TRY', 'CONVERSION', 'PENALTY', 'DROP_GOAL'] as const,
  });

  builder.prismaObject('Score', {
    fields: (t) => ({
      id: t.exposeID('id'),
      type: t.expose('type', { type: ScoreTypeEnum }),
      minute: t.exposeInt('minute', { nullable: true }),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      fixture: t.relation('fixture'),
      player: t.relation('player', { nullable: true }),
    }),
  });

  return { ScoreTypeEnum };
}
