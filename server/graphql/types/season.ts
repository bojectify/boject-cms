import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Season', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    startDate: t.expose('startDate', { type: 'DateTime' }),
    endDate: t.expose('endDate', { type: 'DateTime' }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    competitions: t.relation('competitions'),
    fixtures: t.relation('fixtures'),
  }),
});

export const _registered = true;
