import {
  isCmsRequest,
  getVersionForContext,
  getPublishedVersion,
  flattenEntryWithVersion,
} from '../../utils/resolveVersion';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: {
        include: { fields: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const isCms = isCmsRequest(event);
  const version = getVersionForContext(entry.versions, isCms);
  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No visible version for this entry',
    });
  }

  const publishedVersion = getPublishedVersion(entry.versions);
  const hasArchivedVersion = entry.versions.some(
    (v) => v.status === CONTENT_STATUSES.ARCHIVED
  );

  return flattenEntryWithVersion(entry, version, {
    contentType: entry.contentType,
    ...(isCms
      ? {
          hasPublishedVersion: publishedVersion !== null,
          publishedVersionPublishedAt: publishedVersion?.publishedAt ?? null,
          hasArchivedVersion,
        }
      : {}),
  });
});
