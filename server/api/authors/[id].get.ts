export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const author = await prisma.author.findUnique({
    where: { id },
    include: { socialLinks: true, headshot: true },
  });
  if (!author) {
    throw createError({ statusCode: 404, statusMessage: 'Author not found' });
  }
  return author;
});
