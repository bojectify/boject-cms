import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Image', {
  fields: (t) => ({
    id: t.exposeID('id'),
    url: t.exposeString('url'),
    alt: t.exposeString('alt'),
    width: t.exposeInt('width'),
    height: t.exposeInt('height'),
    storagePath: t.exposeString('storagePath', { nullable: true }),
    mimeType: t.exposeString('mimeType', { nullable: true }),
    fileSize: t.exposeInt('fileSize', { nullable: true }),
    originalName: t.exposeString('originalName', { nullable: true }),
    focalPointX: t.exposeFloat('focalPointX'),
    focalPointY: t.exposeFloat('focalPointY'),
    transformUrl: t.string({
      nullable: true,
      resolve: (image) =>
        image.storagePath ? `/api/images/${image.id}/transform` : null,
    }),
    placeholderUrl: t.string({
      nullable: true,
      resolve: (image) =>
        image.storagePath ? `/api/images/${image.id}/placeholder` : null,
    }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

export const _registered = true;
