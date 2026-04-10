export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.navigationId || typeof body.navigationId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'navigationId is required',
    });
  }
  if (!body.linkId || typeof body.linkId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'linkId is required',
    });
  }

  // Enforce two-level depth
  if (body.parentId && typeof body.parentId === 'string') {
    const parent = await prisma.navigationItem.findUnique({
      where: { id: body.parentId },
    });
    if (parent?.parentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const created = await prisma.navigationItem.create({
    data: {
      navigationId: body.navigationId as string,
      linkId: body.linkId as string,
      parentId: (body.parentId as string) || null,
      order: typeof body.order === 'number' ? body.order : 0,
    },
    include: { link: { include: { article: true } } },
  });
  setResponseStatus(event, 201);
  return created;
});
