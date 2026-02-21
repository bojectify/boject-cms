import { builder } from '../builder';

builder.prismaObject('Club', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
    crest: t.relation('crest', { nullable: true }),
    fixtures: t.relation('fixtures'),
  }),
});


export const _registered = true;