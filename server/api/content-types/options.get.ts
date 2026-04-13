export default defineEventHandler(async () => {
  const types = await prisma.contentType.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return types.map((t) => ({ label: t.name, value: t.id }));
});
