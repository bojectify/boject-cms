export default defineEventHandler(async (event) => {
  const body = await readBody<{
    items: { id: string; order: number; parentId: string | null }[];
  }>(event);

  if (!Array.isArray(body.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'items array is required',
    });
  }

  const updated = await prisma.$transaction(
    body.items.map((item) =>
      prisma.navigationItem.update({
        where: { id: item.id },
        data: { order: item.order, parentId: item.parentId },
      })
    )
  );

  return updated;
});
