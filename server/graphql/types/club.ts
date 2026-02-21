import { builder } from '../builder';

builder.prismaObject('Club', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    crest: t.relation('crest', { nullable: true }),
    fixtures: t.relation('fixtures'),
  }),
});

export const _registered = true;
