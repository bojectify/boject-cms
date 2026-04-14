import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';

export function registerPositionType(
  builder: Builder,
  filters: StaticFilterRefs
) {
  builder.prismaObject('Position', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      players: t.relatedConnection('players', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.PlayerWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
