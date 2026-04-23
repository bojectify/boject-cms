import type { Prisma, ContentEntryVersion } from '#prisma';
import { assertUuid } from '../utils/validation';
import {
  isCmsRequest,
  getVersionForContext,
  flattenEntryWithVersion,
} from '../utils/resolveVersion';

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
  const where: Prisma.ContentEntryWhereInput = { contentTypeId };

  const archiveFilter: ArchiveFilter =
    typeof query.archiveFilter === 'string' &&
    (VALID_ARCHIVE_FILTERS as readonly string[]).includes(query.archiveFilter)
      ? (query.archiveFilter as ArchiveFilter)
      : 'active';

  if (isCms) {
    // CMS: filter by status on versions if requested
    if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
      where.versions = {
        some: {
          status: query.status as
            | 'DRAFT'
            | 'PUBLISHED'
            | 'CHANGED'
            | 'ARCHIVED',
        },
      };
    } else if (archiveFilter === 'archived') {
      where.versions = { some: { status: 'ARCHIVED' } };
    } else if (archiveFilter === 'active') {
      where.versions = { none: { status: 'ARCHIVED' } };
    }
    // 'all': leave where.versions alone
  } else {
    // API key: only return entries that have a PUBLISHED version
    // (existing PUBLISHED filter already excludes archived)
    where.versions = { some: { status: 'PUBLISHED' } };
  }

  const [entries, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      include: { versions: true },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const items = entries
    .map((entry) => {
      let version: ContentEntryVersion | undefined;
      if (isCms && archiveFilter === 'archived') {
        version = entry.versions.find((v) => v.status === 'ARCHIVED');
      } else {
        version = getVersionForContext(entry.versions, isCms) ?? undefined;
        if (!version && isCms && archiveFilter === 'all') {
          version = entry.versions.find((v) => v.status === 'ARCHIVED');
        }
      }
      if (!version) return null;
      return flattenEntryWithVersion(entry, version);
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { items, total };
});
