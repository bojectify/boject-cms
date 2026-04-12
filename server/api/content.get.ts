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

const STATIC_TABLE_SET = new Set<string>(CONTENT_TABLES);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const offset = (page - 1) * perPage;

  const status =
    typeof query.status === 'string' && VALID_STATUSES.has(query.status)
      ? query.status
      : null;

  // Determine whether the contentType filter targets a static table,
  // a dynamic ContentType, or nothing (show all).
  let staticContentType: string | null = null;
  let dynamicContentType: { id: string; name: string } | null = null;

  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    if (STATIC_TABLE_SET.has(query.contentType)) {
      staticContentType = query.contentType;
    } else {
      // Check if it matches a dynamic ContentType identifier
      const ct = await prisma.contentType.findUnique({
        where: { identifier: query.contentType },
        select: { id: true, name: true },
      });
      if (ct) {
        dynamicContentType = ct;
      }
      // If neither static nor dynamic, fall through with no filter (all content)
    }
  }

  const subqueries: string[] = [];

  // Build static table subqueries unless filtering to a specific dynamic type
  if (!dynamicContentType) {
    const tables = staticContentType
      ? CONTENT_TABLES.filter((t) => t === staticContentType)
      : CONTENT_TABLES;

    // Both table names and status values come from validated allowlists
    const statusWhere = status
      ? ` WHERE status = '${status}'::"ContentStatus"`
      : '';

    for (const t of tables) {
      subqueries.push(
        `SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", '${t}' AS "contentType" FROM "${t}"${statusWhere}`
      );
    }
  }

  // Build dynamic ContentEntry subquery unless filtering to a specific static table
  if (!staticContentType) {
    const dynamicConditions: string[] = [];

    if (dynamicContentType) {
      // Filter to a specific dynamic content type by its id (safe UUID)
      dynamicConditions.push(`ce."contentTypeId" = '${dynamicContentType.id}'`);
    }

    if (status) {
      // status is validated against VALID_STATUSES allowlist
      dynamicConditions.push(`ce.status = '${status}'::"ContentStatus"`);
    }

    const dynamicWhere =
      dynamicConditions.length > 0
        ? ` WHERE ${dynamicConditions.join(' AND ')}`
        : '';

    subqueries.push(
      `SELECT ce.id, COALESCE(ce.data ->> etf.identifier, 'Untitled') AS "entryTitle", ce.status::text, ce."createdAt", ce."updatedAt", ct.name AS "contentType" FROM "ContentEntry" ce JOIN "ContentType" ct ON ce."contentTypeId" = ct.id LEFT JOIN "ContentTypeField" etf ON etf."contentTypeId" = ct.id AND etf.type = 'ENTRY_TITLE'${dynamicWhere}`
    );
  }

  const unionSql = subqueries.join(' UNION ALL ');

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
