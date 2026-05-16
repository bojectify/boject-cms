import { send, setHeader } from 'h3';
import {
  ALLOWED_TRANSFORM_FORMATS,
  ALLOWED_FIT_VALUES,
  transformImage,
} from '../../../utils/imageProcessing';
import { rateLimit } from '../../../utils/rateLimit';

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9-]+\.(jpeg|jpg|png|webp|gif|avif)$/;

export default defineEventHandler(async (event) => {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const { allowed, retryAfterMs } = rateLimit(`transform:${ip}`);
  if (!allowed) {
    throwRateLimited(event, 'transform', retryAfterMs);
  }

  const storageKey = getRouterParam(event, 'storageKey');
  if (!storageKey || !STORAGE_KEY_PATTERN.test(storageKey)) {
    throw createError({ statusCode: 400, message: 'Invalid storage key' });
  }

  const query = getQuery(event);
  const w = query.w ? Number(query.w) : undefined;
  const h = query.h ? Number(query.h) : undefined;
  const f = query.f ? String(query.f) : undefined;
  const q = query.q ? Number(query.q) : undefined;
  const fit = query.fit ? String(query.fit) : undefined;
  const fpx = query.fpx ? Number(query.fpx) : undefined;
  const fpy = query.fpy ? Number(query.fpy) : undefined;

  if (w !== undefined && (isNaN(w) || w <= 0 || w > 4000)) {
    throw createError({ statusCode: 400, message: 'Invalid width parameter' });
  }
  if (h !== undefined && (isNaN(h) || h <= 0 || h > 4000)) {
    throw createError({ statusCode: 400, message: 'Invalid height parameter' });
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

  const originalsStorage = useStorage('images:originals');
  const originalBuffer = await originalsStorage.getItemRaw<Buffer>(storageKey);
  if (!originalBuffer) {
    throw createError({ statusCode: 404, message: 'File not found' });
  }

  const extMatch = storageKey.match(/\.([^.]+)$/);
  const originalFormat = extMatch ? extMatch[1] : 'webp';
  const originalMime = `image/${originalFormat === 'jpg' ? 'jpeg' : originalFormat}`;

  const hasTransformParams = w || h || f || q || fit || fpx || fpy;
  if (!hasTransformParams) {
    setHeader(event, 'Content-Type', originalMime);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(originalBuffer));
  }

  const cacheKey = `files/${storageKey}/${w ?? '_'}_${h ?? '_'}_${f ?? '_'}_${q ?? '_'}_${fit ?? '_'}_${fpx ?? '_'}_${fpy ?? '_'}`;
  const transformsStorage = useStorage('images:transforms');

  const cached = await transformsStorage.getItemRaw<Buffer>(cacheKey);
  if (cached) {
    const contentType = f ? `image/${f}` : originalMime;
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(cached));
  }

  const { data, contentType } = await transformImage(
    Buffer.from(originalBuffer),
    { w, h, f, q, fit, fpx, fpy }
  );

  await transformsStorage.setItemRaw(cacheKey, data);

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return send(event, data);
});
