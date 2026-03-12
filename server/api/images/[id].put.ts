import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.image.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' });
  }

  const data: Prisma.ImageUncheckedUpdateInput = {};
  if ('url' in body) data.url = body.url as string;
  if ('alt' in body) data.alt = body.alt as string;
  if ('width' in body) data.width = Number(body.width);
  if ('height' in body) data.height = Number(body.height);
  if ('focalPointX' in body) data.focalPointX = Number(body.focalPointX);
  if ('focalPointY' in body) data.focalPointY = Number(body.focalPointY);
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.image.update({ where: { id }, data });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'An image with this slug already exists',
      });
    }
    throw err;
  }
});
