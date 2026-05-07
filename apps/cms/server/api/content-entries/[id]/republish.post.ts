import { assertUuid } from '../../../utils/validation';
import {
  flattenEntryWithVersion,
  getPublishedVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import {
  planTransition,
  applyTransitionMutations,
} from '../../../utils/entryTransitions';
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.republish');
  assertApiKeyScope(event, 'content:write');
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

  const plan = planTransition(entry, 'republish');
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

  const full = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const published = getPublishedVersion(full.versions);
  if (!published) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Republish left entry without a PUBLISHED version',
    });
  }
  return flattenEntryWithVersion(full, published, {
    contentType: full.contentType,
    hasPublishedVersion: true,
    publishedVersionPublishedAt: published.publishedAt,
  });
});
