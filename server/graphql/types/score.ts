import { builder } from '../builder';

export const ScoreTypeEnum = builder.enumType('ScoreType', {
  values: ['TRY', 'CONVERSION', 'PENALTY', 'DROP_GOAL'] as const,
});

builder.prismaObject('Score', {
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.expose('type', { type: ScoreTypeEnum }),
    minute: t.exposeInt('minute', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    fixture: t.relation('fixture'),
    player: t.relation('player', { nullable: true }),
  }),
});
