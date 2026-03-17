export default defineEventHandler(async () => {
  const images = await prisma.image.findMany({
    select: { id: true, entryTitle: true, originalName: true },
    orderBy: { updatedAt: 'desc' },
  });
  return images.map((i) => ({
    label: i.entryTitle || i.originalName || i.id,
    value: i.id,
  }));
});
