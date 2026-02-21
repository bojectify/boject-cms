import { builder } from '../builder';

builder.prismaObject('Image', {
  fields: (t) => ({
    id: t.exposeID('id'),
    url: t.exposeString('url'),
    alt: t.exposeString('alt'),
    width: t.exposeInt('width'),
    height: t.exposeInt('height'),
    createdAt: t.expose('createdAt', { type: 'String' }),
    updatedAt: t.expose('updatedAt', { type: 'String' }),
  }),
});


export const _registered = true;