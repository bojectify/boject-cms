export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const tagGroup = await prisma.tagGroup.findUnique({
    where: { id },
    include: { tags: true },
  });
  if (!tagGroup) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Tag group not found',
    });
  }
  return tagGroup;
});
