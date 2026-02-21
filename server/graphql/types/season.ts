import { builder } from '../builder';

builder.prismaObject('Season', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    startDate: t.expose('startDate', { type: 'String' }),
    endDate: t.expose('endDate', { type: 'String' }),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    competitions: t.relation('competitions'),
    fixtures: t.relation('fixtures'),
  }),
});


export const _registered = true;