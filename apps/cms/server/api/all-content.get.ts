import type { ContentStatusName } from '../../utils/contentStatus';
import { CONTENT_STATUSES_SET } from '../../utils/contentStatus';
import { isCmsRequest } from '../utils/resolveVersion';
import {
  buildEntryListWhere,
  fetchDisplayVersions,
  parseArchiveFilter,
  resolveDisplayVersion,
} from '../utils/listEntries';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const offset = (page - 1) * perPage;

  const isCms = isCmsRequest(event);
  const archiveFilter = parseArchiveFilter(query.archiveFilter);

  let contentTypeId: string | null = null;
  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: query.contentType },
      select: { id: true },
    });
    if (ct) contentTypeId = ct.id;
    else return { items: [], total: 0 };
  }

  const status =
    typeof query.status === 'string' &&
    CONTENT_STATUSES_SET.has(query.status as ContentStatusName)
      ? (query.status as ContentStatusName)
      : null;

  const where = buildEntryListWhere({
    isCms,
    archiveFilter,
    status,
    contentTypeId,
  });

  const [rows, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: offset,
      take: perPage,
      select: {
        id: true,
        entryTitle: true,
        entryKey: true,
        createdAt: true,
        updatedAt: true,
        contentTypeId: true,
        contentType: { select: { name: true } },
      },
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const versionsByEntry = await fetchDisplayVersions(
    prisma,
    rows.map((r) => r.id),
    { includeData: false }
  );

  const items = rows
    .map((r) => {
      const version = resolveDisplayVersion(versionsByEntry.get(r.id) ?? [], {
        isCms,
        archiveFilter,
      });
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
