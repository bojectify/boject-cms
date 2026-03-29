export default defineEventHandler(async () => {
  const tagGroups = await prisma.tagGroup.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return tagGroups.map((tg) => ({ label: tg.name, value: tg.id }));
});
