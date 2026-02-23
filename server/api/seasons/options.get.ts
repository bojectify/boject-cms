export default defineEventHandler(async () => {
  const seasons = await prisma.season.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return seasons.map((s) => ({ label: s.name, value: s.id }));
});
