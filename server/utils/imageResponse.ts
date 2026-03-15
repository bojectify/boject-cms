import type { Image } from '#prisma';

export type ImageResponse = Image & {
  placeholderUrl: string | null;
};

export function toImageResponse(image: Image): ImageResponse {
  return {
    ...image,
    placeholderUrl: image.storagePath
      ? `/api/images/${image.id}/placeholder`
      : null,
  };
}
