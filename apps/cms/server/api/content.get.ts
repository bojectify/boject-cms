import type { Prisma, ContentEntryVersion } from '#prisma';
import { isCmsRequest, getVersionForContext } from '../utils/resolveVersion';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

const VALID_ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
type ArchiveFilter = (typeof VALID_ARCHIVE_FILTERS)[number];

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

  const archiveFilter: ArchiveFilter =
    typeof query.archiveFilter === 'string' &&
    (VALID_ARCHIVE_FILTERS as readonly string[]).includes(query.archiveFilter)
      ? (query.archiveFilter as ArchiveFilter)
      : 'active';

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
    } else if (archiveFilter === 'archived') {
      where.versions = { some: { status: 'ARCHIVED' } };
    } else if (archiveFilter === 'active') {
      where.versions = { none: { status: 'ARCHIVED' } };
    }
    // 'all': leave where.versions alone
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
      let version: ContentEntryVersion | undefined;
      if (isCms && archiveFilter === 'archived') {
        version = r.versions.find((v) => v.status === 'ARCHIVED');
      } else {
        version = getVersionForContext(r.versions, isCms) ?? undefined;
        if (!version && isCms && archiveFilter === 'all') {
          version = r.versions.find((v) => v.status === 'ARCHIVED');
        }
      }
      if (!version) return null;
      return {
        id: r.id,
        entryTitle: r.entryTitle,
        entryKey: r.entryKey,
        status: version.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        contentType: r.contentType.name,
        contentTypeId: r.contentTypeId,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { items, total };
});
