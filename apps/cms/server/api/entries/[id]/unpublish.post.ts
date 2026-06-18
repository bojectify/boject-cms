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
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'entries.unpublish');
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

  const plan = planTransition(entry, 'unpublish');
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
  const draft = getDraftVersion(refreshed.versions);
  if (!draft) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unpublish left entry with no draft',
    });
  }
  return flattenEntryWithVersion(refreshed, draft, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
