import { setHeader } from 'h3';
import { transformImage } from '../../../utils/imageProcessing';
import { rateLimit } from '../../../utils/rateLimit';

const PLACEHOLDER_WIDTH = 20;
const PLACEHOLDER_QUALITY = 30;
const PLACEHOLDER_FORMAT = 'webp';

export default defineEventHandler(async (event) => {
  // Rate limit by IP (shared bucket with transforms)
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

  const image = await prisma.image.findUnique({ where: { id } });
  if (!image || !image.storagePath) {
    throw createError({ statusCode: 404, message: 'Image not found' });
  }

  // Check cache
  const cacheKey = `${id}/placeholder`;
  const transformsStorage = useStorage('images:transforms');
  const cached = await transformsStorage.getItem<string>(cacheKey);
  if (cached) {
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return { dataUri: cached };
  }

  // Load original
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

  // Generate tiny placeholder
  const { data } = await transformImage(Buffer.from(originalBuffer), {
    w: PLACEHOLDER_WIDTH,
    f: PLACEHOLDER_FORMAT,
    q: PLACEHOLDER_QUALITY,
  });

  const dataUri = `data:image/webp;base64,${data.toString('base64')}`;

  // Cache the data URI string
  await transformsStorage.setItem(cacheKey, dataUri);

  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return { dataUri };
});
