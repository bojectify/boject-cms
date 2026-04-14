import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';

export function registerSeasonType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Season', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      startDate: t.expose('startDate', { type: 'DateTime' }),
      endDate: t.expose('endDate', { type: 'DateTime' }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      competitions: t.relatedConnection('competitions', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.CompetitionWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
      fixtures: t.relatedConnection('fixtures', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.FixtureWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
