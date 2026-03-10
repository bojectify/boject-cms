import sharp from 'sharp';

export const IMAGE_UPLOAD_MAX_SIZE = 5 * 1024 * 1024; // 5MB
export const IMAGE_MAX_DIMENSION = 4000;

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const ALLOWED_TRANSFORM_FORMATS = new Set([
  'jpeg',
  'png',
  'webp',
  'avif',
]);

export const ALLOWED_FIT_VALUES = new Set([
  'cover',
  'contain',
  'fill',
  'inside',
  'outside',
]);

export async function processOriginal(buffer: Buffer) {
  const pipeline = sharp(buffer).rotate(); // auto-orient, strips EXIF

  const metadata = await pipeline.metadata();

  // Downscale if wider than max dimension, preserving aspect ratio
  if ((metadata.width ?? 0) > IMAGE_MAX_DIMENSION) {
    pipeline.resize(IMAGE_MAX_DIMENSION, undefined, {
      withoutEnlargement: true,
    });
  }

  const result = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    format: result.info.format,
  };
}

export async function transformImage(
  buffer: Buffer,
  params: {
    w?: number;
    h?: number;
    f?: string;
    q?: number;
    fit?: string;
  }
) {
  let pipeline = sharp(buffer);

  if (params.w || params.h) {
    pipeline = pipeline.resize(params.w || undefined, params.h || undefined, {
      fit: (params.fit as keyof sharp.FitEnum) || 'cover',
      withoutEnlargement: true,
    });
  }

  const format = params.f ?? 'webp';
  const quality = params.q ?? 80;

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality });
      break;
    case 'png':
      pipeline = pipeline.png({ quality });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
  }

  const data = await pipeline.toBuffer();
  const contentType = `image/${format === 'jpeg' ? 'jpeg' : format}`;

  return { data, contentType };
}
