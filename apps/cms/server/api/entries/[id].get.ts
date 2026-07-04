import {
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

  // Admin content reads are session-only after #257 (the auth middleware bars
  // API-key tokens from /api/entries/:id), so version resolution is
  // unconditionally the draft-priority CMS path and the CMS-only response extras
  // are always present. The PUBLISHED-only path lives on for API-key consumers
  // at /api/public/entries.
  const version = getVersionForContext(entry.versions, true);
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
    hasPublishedVersion: publishedVersion !== null,
    publishedVersionPublishedAt: publishedVersion?.publishedAt ?? null,
    hasArchivedVersion,
  });
});
