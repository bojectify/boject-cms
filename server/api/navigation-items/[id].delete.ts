export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');

  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  await prisma.navigationItem.delete({ where: { id } });
  return { success: true };
});
