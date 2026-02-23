import { builder } from '../builder';
import { CompetitionWhere, FixtureWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Season', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    startDate: t.expose('startDate', { type: 'DateTime' }),
    endDate: t.expose('endDate', { type: 'DateTime' }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    competitions: t.relatedConnection('competitions', {
      cursor: 'id',
      args: { where: t.arg({ type: CompetitionWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
    fixtures: t.relatedConnection('fixtures', {
      cursor: 'id',
      args: { where: t.arg({ type: FixtureWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
