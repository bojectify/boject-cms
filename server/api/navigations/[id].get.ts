export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const navigation = await prisma.navigation.findUnique({
    where: { id },
    include: {
      items: {
        where: { parentId: null },
        orderBy: { order: 'asc' },
        include: {
          link: { include: { article: true } },
          children: {
            orderBy: { order: 'asc' },
            include: {
              link: { include: { article: true } },
            },
          },
        },
      },
    },
  });
  if (!navigation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation not found',
    });
  }
  return navigation;
});
