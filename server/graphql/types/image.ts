import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Image', {
  fields: (t) => ({
    id: t.exposeID('id'),
    url: t.exposeString('url'),
    alt: t.exposeString('alt'),
    width: t.exposeInt('width'),
    height: t.exposeInt('height'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

export const _registered = true;
