export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const link = await prisma.link.findUnique({
    where: { id },
    include: { article: true },
  });
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Link not found' });
  }
  return link;
});
