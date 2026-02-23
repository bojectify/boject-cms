export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Number(query.perPage) || 15);
  const offset = (page - 1) * perPage;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      entryTitle: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      contentType: string;
      total: bigint;
    }>
  >`
    SELECT *, count(*) OVER() AS total
    FROM (
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Team' AS "contentType" FROM "Team"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Club' AS "contentType" FROM "Club"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Competition' AS "contentType" FROM "Competition"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Season' AS "contentType" FROM "Season"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Fixture' AS "contentType" FROM "Fixture"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Player' AS "contentType" FROM "Player"
      UNION ALL
      SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", 'Image' AS "contentType" FROM "Image"
    ) AS content
    ORDER BY "updatedAt" DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  const total = rows[0] ? Number(rows[0].total) : 0;
  const items = rows.map(({ total: _total, ...rest }) => rest);

  return { items, total };
});
