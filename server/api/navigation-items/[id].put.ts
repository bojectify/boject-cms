export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  // Enforce two-level depth if parentId is changing
  if ('parentId' in body && body.parentId) {
    const parent = await prisma.navigationItem.findUnique({
      where: { id: body.parentId as string },
    });
    if (parent?.parentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const data: Record<string, unknown> = {};
  if ('order' in body) data.order = Number(body.order);
  if ('parentId' in body) data.parentId = (body.parentId as string) || null;
  if ('linkId' in body) data.linkId = body.linkId as string;

  return await prisma.navigationItem.update({
    where: { id },
    data,
    include: { link: { include: { article: true } } },
  });
});
