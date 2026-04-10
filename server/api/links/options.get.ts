export default defineEventHandler(async () => {
  const links = await prisma.link.findMany({
    select: { id: true, label: true },
    orderBy: { label: 'asc' },
  });
  return links.map((l) => ({ label: l.label, value: l.id }));
});
