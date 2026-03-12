import { send, setHeader } from 'h3';
import {
  ALLOWED_TRANSFORM_FORMATS,
  ALLOWED_FIT_VALUES,
  transformImage,
} from '../../../utils/imageProcessing';
import { rateLimit } from '../../../utils/rateLimit';

export default defineEventHandler(async (event) => {
  // Rate limit by IP
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const { allowed, retryAfterMs } = rateLimit(`transform:${ip}`);
  if (!allowed) {
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({ statusCode: 429, message: 'Too many requests' });
  }

  const id = getRouterParam(event, 'id');

  // Look up image
  const image = await prisma.image.findUnique({ where: { id } });
  if (!image || !image.storagePath) {
    throw createError({ statusCode: 404, message: 'Image not found' });
  }

  // Parse and validate query params
  const query = getQuery(event);
  const w = query.w ? Number(query.w) : undefined;
  const h = query.h ? Number(query.h) : undefined;
  const f = query.f ? String(query.f) : undefined;
  const q = query.q ? Number(query.q) : undefined;
  const fit = query.fit ? String(query.fit) : undefined;
  const fpx = query.fpx ? Number(query.fpx) : undefined;
  const fpy = query.fpy ? Number(query.fpy) : undefined;

  // Validate params
  if (w !== undefined && (isNaN(w) || w <= 0 || w > 4000)) {
    throw createError({ statusCode: 400, message: 'Invalid width parameter' });
  }
  if (h !== undefined && (isNaN(h) || h <= 0 || h > 4000)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid height parameter',
    });
  }
  if (f !== undefined && !ALLOWED_TRANSFORM_FORMATS.has(f)) {
    throw createError({
      statusCode: 400,
      message: `Invalid format. Allowed: ${[...ALLOWED_TRANSFORM_FORMATS].join(', ')}`,
    });
  }
  if (q !== undefined && (isNaN(q) || q < 1 || q > 100)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid quality parameter (1-100)',
    });
  }
  if (fit !== undefined && !ALLOWED_FIT_VALUES.has(fit)) {
    throw createError({
      statusCode: 400,
      message: `Invalid fit value. Allowed: ${[...ALLOWED_FIT_VALUES].join(', ')}`,
    });
  }
  if (fpx !== undefined && (isNaN(fpx) || fpx < 0 || fpx > 1)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid fpx parameter (0-1)',
    });
  }
  if (fpy !== undefined && (isNaN(fpy) || fpy < 0 || fpy > 1)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid fpy parameter (0-1)',
    });
  }
  if ((fpx !== undefined || fpy !== undefined) && (!w || !h)) {
    throw createError({
      statusCode: 400,
      message: 'Focal point requires both w and h parameters',
    });
  }

  // Use DB focal point as fallback when resizing with both dimensions
  const effectiveFpx = fpx ?? (w && h ? image.focalPointX : undefined);
  const effectiveFpy = fpy ?? (w && h ? image.focalPointY : undefined);
  // Skip focal point logic if it's the default center (0.5, 0.5) and not explicitly requested
  const hasFocalPointOverride =
    fpx !== undefined ||
    fpy !== undefined ||
    (w && h && (image.focalPointX !== 0.5 || image.focalPointY !== 0.5));

  const originalsStorage = useStorage('images:originals');
  const originalBuffer = await originalsStorage.getItemRaw<Buffer>(
    image.storagePath
  );
  if (!originalBuffer) {
    throw createError({
      statusCode: 404,
      message: 'Original image file not found',
    });
  }

  // If no transform params, serve original
  const hasTransformParams = w || h || f || q || fit || fpx || fpy;
  if (!hasTransformParams) {
    setHeader(
      event,
      'Content-Type',
      image.mimeType ?? 'application/octet-stream'
    );
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(originalBuffer));
  }

  // Build cache key
  const cacheKey = `${id}/${w ?? '_'}_${h ?? '_'}_${f ?? '_'}_${q ?? '_'}_${fit ?? '_'}_${effectiveFpx ?? '_'}_${effectiveFpy ?? '_'}`;
  const transformsStorage = useStorage('images:transforms');

  // Check cache
  const cached = await transformsStorage.getItemRaw<Buffer>(cacheKey);
  if (cached) {
    const contentType = f ? `image/${f}` : (image.mimeType ?? 'image/webp');
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(cached));
  }

  // Transform
  const { data, contentType } = await transformImage(
    Buffer.from(originalBuffer),
    {
      w,
      h,
      f,
      q,
      fit,
      fpx: hasFocalPointOverride ? effectiveFpx : undefined,
      fpy: hasFocalPointOverride ? effectiveFpy : undefined,
    }
  );

  // Cache the result
  await transformsStorage.setItemRaw(cacheKey, data);

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return send(event, data);
});
