import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Club', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    crest: t.relation('crest', { nullable: true }),
    fixtures: t.relation('fixtures'),
  }),
});

export const _registered = true;
