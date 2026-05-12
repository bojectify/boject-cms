import { assertUuid } from '../../../utils/validation';
import { flattenEntryWithVersion } from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import {
  applyTransitionMutations,
  planTransition,
} from '../../../utils/entryTransitions';
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'content-entries.archive');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'archive');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransitionMutations(tx, plan.mutations);
    if (plan.webhookEvent && plan.snapshot) {
      await enqueueWebhookDeliveries(tx, {
        event: plan.webhookEvent,
        contentType: entry.contentType,
        entry: plan.snapshot,
      });
    }
  });

  const refreshed = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const archived = refreshed.versions.find((v) => v.status === 'ARCHIVED');
  if (!archived) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Archive left entry without an ARCHIVED version',
    });
  }
  return flattenEntryWithVersion(refreshed, archived, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
