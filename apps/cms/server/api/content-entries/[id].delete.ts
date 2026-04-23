import type { ContentEntryVersion } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { enqueueWebhookDeliveries } from '../../utils/webhooks';
import { getPublishedVersion } from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
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
              status: 'PUBLISHED',
              publishedAt: publishedVersion.publishedAt,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              data: publishedVersion.data,
            },
          });
        }
        await tx.contentEntry.delete({ where: { id } });
      }),
    { notFoundMessage: 'Content entry not found' }
  );

  return { success: true };
});
