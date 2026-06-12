import { assertUuid } from '../../../utils/validation';
import {
  flattenEntryWithVersion,
  getDraftVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import {
  applyTransitionMutations,
  planTransition,
} from '../../../utils/entryTransitions';
import { enqueueEntryDraftSync } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
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
    await applyTransitionMutations(tx, plan.mutations);
    await enqueueEntryDraftSync(tx, {
      contentType: { id: entry.contentType.id },
      entryId: entry.id,
    });
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
