import type { ContentEntryVersion } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import {
  enqueueWebhookDeliveries,
  enqueueEntryDraftSync,
} from '../../utils/webhooks';
import { getPublishedVersion } from '../../utils/resolveVersion';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'content-entries.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const publishedVersion: ContentEntryVersion | null = getPublishedVersion(
    existing.versions
  );

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (publishedVersion) {
          await enqueueWebhookDeliveries(tx, {
            event: 'ENTRY_DELETED',
            contentType: existing.contentType,
            entry: {
              id: existing.id,
              entryTitle: existing.entryTitle,
              slug: existing.slug,
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: publishedVersion.publishedAt,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              data: publishedVersion.data,
            },
          });
        } else {
          // Draft-only delete: ENTRY_DELETED never fires here, so use the
          // internal trigger to prune the entry's draft doc from the index.
          await enqueueEntryDraftSync(tx, {
            contentType: { id: existing.contentType.id },
            entryId: existing.id,
          });
        }
        await tx.contentEntry.delete({ where: { id } });
      }),
    { notFoundMessage: 'Content entry not found' }
  );

  return { success: true };
});
