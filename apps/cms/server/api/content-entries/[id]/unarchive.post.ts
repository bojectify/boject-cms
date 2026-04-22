import { assertUuid } from '../../../utils/validation';
import {
  isCmsRequest,
  flattenEntryWithVersion,
  getDraftVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { planTransition } from '../../../utils/entryTransitions';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'content-entries.unarchive');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true, contentType: true },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'unarchive');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const m of plan.mutations) {
      if (m.kind === 'delete') {
        await tx.contentEntryVersion.delete({ where: { id: m.versionId } });
      } else {
        const data: { status: typeof m.status; publishedAt?: Date | null } = {
          status: m.status,
        };
        if ('publishedAt' in m) {
          data.publishedAt = m.publishedAt;
        }
        await tx.contentEntryVersion.update({
          where: { id: m.versionId },
          data,
        });
      }
    }
  });

  const refreshed = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const draft = getDraftVersion(refreshed.versions);
  if (!draft) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unarchive left entry with no draft',
    });
  }
  return flattenEntryWithVersion(refreshed, draft, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
