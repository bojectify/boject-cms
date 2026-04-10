import { Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

const CONTENT_TABLES = [
  'Team',
  'Club',
  'Competition',
  'Season',
  'Fixture',
  'Player',
  'Image',
  'Author',
  'Tag',
  'TagGroup',
  'Article',
  'Link',
  'Navigation',
] as const;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const offset = (page - 1) * perPage;

  const contentType =
    typeof query.contentType === 'string' &&
    CONTENT_TABLES.includes(
      query.contentType as (typeof CONTENT_TABLES)[number]
    )
      ? query.contentType
      : null;

  const status =
    typeof query.status === 'string' && VALID_STATUSES.has(query.status)
      ? query.status
      : null;

  const tables = contentType
    ? CONTENT_TABLES.filter((t) => t === contentType)
    : CONTENT_TABLES;

  // Both table names and status values come from validated allowlists
  const statusWhere = status
    ? ` WHERE status = '${status}'::"ContentStatus"`
    : '';

  const unionSql = tables
    .map(
      (t) =>
        `SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", '${t}' AS "contentType" FROM "${t}"${statusWhere}`
    )
    .join(' UNION ALL ');

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
    FROM (${Prisma.raw(unionSql)}) AS content
    ORDER BY "updatedAt" DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  const total = rows[0] ? Number(rows[0].total) : 0;
  const items = rows.map(({ total: _total, ...rest }) => rest);

  return { items, total };
});
