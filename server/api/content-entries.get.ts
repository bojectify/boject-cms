import type { Prisma } from '#prisma';
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

  if (isCms) {
    // CMS: filter by status on versions if requested
    if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
      where.versions = {
        some: {
          status: query.status as 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED',
        },
      };
    }
  } else {
    // API key: only return entries that have a PUBLISHED version
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
      const version = getVersionForContext(entry.versions, isCms);
      if (!version) return null;
      return flattenEntryWithVersion(entry, version);
    })
    .filter(Boolean);

  return { items, total };
});
