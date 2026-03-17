export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const article = await prisma.article.findUnique({
    where: { id },
    include: { author: true, tags: true, featuredImage: true },
  });
  if (!article) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found',
    });
  }
  return article;
});
