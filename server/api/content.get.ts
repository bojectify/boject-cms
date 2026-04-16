import type { Prisma } from '#prisma';
import {
  isCmsRequest,
  getVersionForContext,
} from '../utils/resolveVersion';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const offset = (page - 1) * perPage;

  const isCms = isCmsRequest(event);

  let contentTypeId: string | null = null;
  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: query.contentType },
      select: { id: true },
    });
    if (ct) contentTypeId = ct.id;
    else return { items: [], total: 0 };
  }

  const where: Prisma.ContentEntryWhereInput = {};
  if (contentTypeId) where.contentTypeId = contentTypeId;

  if (isCms) {
    // CMS: filter by status on versions if requested
    const status =
      typeof query.status === 'string' && VALID_STATUSES.has(query.status)
        ? query.status
        : null;
    if (status) {
      where.versions = {
        some: {
          status: status as 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED',
        },
      };
    }
  } else {
    // API key: only show entries with a PUBLISHED version
    where.versions = { some: { status: 'PUBLISHED' } };
  }

  const [rows, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: offset,
      take: perPage,
      include: {
        versions: true,
        contentType: { select: { name: true } },
      },
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const items = rows
    .map((r) => {
      const version = getVersionForContext(r.versions, isCms);
      if (!version) return null;
      return {
        id: r.id,
        entryTitle: r.entryTitle,
        status: version.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        contentType: r.contentType.name,
        contentTypeId: r.contentTypeId,
      };
    })
    .filter(Boolean);

  return { items, total };
});
