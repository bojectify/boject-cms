import { toImageResponse } from '../../utils/imageResponse';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const image = await prisma.image.findUnique({ where: { id } });
  if (!image) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' });
  }
  return toImageResponse(image);
});
