import { assertUuid } from '../utils/validation';
import { isCmsRequest, flattenEntryWithVersion } from '../utils/resolveVersion';
import {
  CONTENT_STATUS_NAMES,
  type ContentStatusName,
} from '../../utils/contentStatus';
import {
  buildEntryListWhere,
  fetchDisplayVersions,
  parseArchiveFilter,
  resolveDisplayVersion,
} from '../utils/listEntries';

const VALID_STATUSES = new Set<string>(CONTENT_STATUS_NAMES);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  if (!query.contentTypeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentTypeId is required',
    });
  }
  const contentTypeId = assertUuid(query.contentTypeId, 'contentTypeId');

  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const isCms = isCmsRequest(event);
  const archiveFilter = parseArchiveFilter(query.archiveFilter);

  const status =
    typeof query.status === 'string' && VALID_STATUSES.has(query.status)
      ? (query.status as ContentStatusName)
      : null;

  const where = buildEntryListWhere({
    isCms,
    archiveFilter,
    status,
    contentTypeId,
  });

  const [entries, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const versionsByEntry = await fetchDisplayVersions(
    prisma,
    entries.map((e) => e.id),
    { includeData: true }
  );

  const items = entries
    .map((entry) => {
      const version = resolveDisplayVersion(
        versionsByEntry.get(entry.id) ?? [],
        { isCms, archiveFilter }
      );
      if (!version) return null;
      return flattenEntryWithVersion(entry, version);
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { items, total };
});
