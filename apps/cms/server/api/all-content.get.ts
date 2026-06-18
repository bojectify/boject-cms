import type { ContentStatusName } from '../../utils/contentStatus';
import { CONTENT_STATUSES_SET } from '../../utils/contentStatus';
import { isCmsRequest } from '../utils/resolveVersion';
import {
  buildEntryListWhere,
  fetchDisplayVersions,
  parseArchiveFilter,
  resolveDisplayVersion,
  keysetPage,
  EMPTY_PAGE_INFO,
  InvalidCursorError,
} from '../utils/listEntries';

type LeanRow = {
  id: string;
  entryTitle: string;
  entryKey: string;
  createdAt: Date;
  updatedAt: Date;
  contentTypeId: string;
  contentType: { name: string };
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const after = typeof query.after === 'string' ? query.after : null;
  const before = typeof query.before === 'string' ? query.before : null;

  const isCms = isCmsRequest(event);
  const archiveFilter = parseArchiveFilter(query.archiveFilter);

  let contentTypeId: string | null = null;
  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: query.contentType },
      select: { id: true },
    });
    if (ct) contentTypeId = ct.id;
    else return { items: [], pageInfo: EMPTY_PAGE_INFO };
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

  let page;
  try {
    page = await keysetPage<LeanRow>(prisma, {
      where,
      perPage,
      after,
      before,
      select: {
        id: true,
        entryTitle: true,
        entryKey: true,
        createdAt: true,
        updatedAt: true,
        contentTypeId: true,
        contentType: { select: { name: true } },
      },
    });
  } catch (e) {
    if (e instanceof InvalidCursorError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' });
    }
    throw e;
  }

  const versionsByEntry = await fetchDisplayVersions(
    prisma,
    page.rows.map((r) => r.id),
    { includeData: false }
  );

  const items = page.rows
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

  return { items, pageInfo: page.pageInfo };
});
