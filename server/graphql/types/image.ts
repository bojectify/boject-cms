import type { Builder } from '../builder';
import type { ContentStatusEnumRef } from './contentStatus';
import { contentMetadataFields } from './contentFields';
import { transformImage } from '../../utils/imageProcessing';

const PLACEHOLDER_WIDTH = 20;
const PLACEHOLDER_QUALITY = 30;
const PLACEHOLDER_FORMAT = 'webp' as const;

export function registerImageType(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef
) {
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
      placeholder: t.string({
        nullable: true,
        resolve: async (image) => {
          if (!image.storagePath) return null;

          // Check cache first
          const cacheKey = `${image.id}/placeholder`;
          const transformsStorage = useStorage('images:transforms');
          const cached = await transformsStorage.getItem<string>(cacheKey);
          if (cached) return cached;

          // Load original and generate placeholder
          const originalsStorage = useStorage('images:originals');
          const originalBuffer = await originalsStorage.getItemRaw<Buffer>(
            image.storagePath
          );
          if (!originalBuffer) return null;

          const { data } = await transformImage(Buffer.from(originalBuffer), {
            w: PLACEHOLDER_WIDTH,
            f: PLACEHOLDER_FORMAT,
            q: PLACEHOLDER_QUALITY,
          });

          const dataUri = `data:image/webp;base64,${data.toString('base64')}`;

          // Cache for future requests
          await transformsStorage.setItem(cacheKey, dataUri);

          return dataUri;
        },
      }),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    }),
  });
}
