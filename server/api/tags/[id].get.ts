export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' });
  }
  return tag;
});
