import sharp from 'sharp';
import type { FitEnum } from 'sharp';

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
    fpx?: number;
    fpy?: number;
  }
) {
  let pipeline = sharp(buffer);

  const hasFocalPoint = params.fpx !== undefined || params.fpy !== undefined;

  if (hasFocalPoint && params.w && params.h) {
    // Focal point crop: resize to cover then extract around the focal point
    const metadata = await sharp(buffer).metadata();
    const srcW = metadata.width ?? params.w;
    const srcH = metadata.height ?? params.h;

    // Calculate scale to cover the target dimensions
    const scale = Math.max(params.w / srcW, params.h / srcH);
    const resizedW = Math.round(srcW * scale);
    const resizedH = Math.round(srcH * scale);

    // Resize without cropping
    pipeline = pipeline.resize(resizedW, resizedH, {
      fit: 'fill',
      withoutEnlargement: true,
    });

    // Re-read dimensions after resize (withoutEnlargement may keep original)
    const actualW = Math.min(resizedW, srcW);
    const actualH = Math.min(resizedH, srcH);

    // Calculate extract region centered on focal point
    const fpx = params.fpx ?? 0.5;
    const fpy = params.fpy ?? 0.5;
    const extractW = Math.min(params.w, actualW);
    const extractH = Math.min(params.h, actualH);

    // Position the crop window so the focal point is centered, clamped to bounds
    const left = Math.round(
      Math.min(Math.max(fpx * actualW - extractW / 2, 0), actualW - extractW)
    );
    const top = Math.round(
      Math.min(Math.max(fpy * actualH - extractH / 2, 0), actualH - extractH)
    );

    pipeline = pipeline.extract({
      left,
      top,
      width: extractW,
      height: extractH,
    });
  } else if (params.w || params.h) {
    pipeline = pipeline.resize(params.w || undefined, params.h || undefined, {
      fit: (params.fit as keyof FitEnum) || 'cover',
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
