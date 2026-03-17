export default defineEventHandler(async () => {
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return tags.map((t) => ({ label: t.name, value: t.id }));
});
