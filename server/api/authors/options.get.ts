export default defineEventHandler(async () => {
  const authors = await prisma.author.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return authors.map((a) => ({ label: a.name, value: a.id }));
});
