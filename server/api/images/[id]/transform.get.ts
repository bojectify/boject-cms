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
  const hasTransformParams = w || h || f || q || fit;
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
  const cacheKey = `${id}/${w ?? '_'}_${h ?? '_'}_${f ?? '_'}_${q ?? '_'}_${fit ?? '_'}`;
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
    { w, h, f, q, fit }
  );

  // Cache the result
  await transformsStorage.setItemRaw(cacheKey, data);

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return send(event, data);
});
