import type { ContentEntryVersion } from '#prisma';
import { withPrismaErrors } from './prismaErrors';
import { enqueueWebhookDeliveries, enqueueEntryDraftSync } from './webhooks';
import { getPublishedVersion } from './resolveVersion';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

export type DeletableEntry = {
  id: string;
  entryTitle: string;
  slug: string | null;
  createdAt: Date;
  updatedAt: Date;
  versions: ContentEntryVersion[];
  contentType: { id: string; identifier: string };
};

/**
 * Delete an entry in one transaction. If a PUBLISHED version exists, fire
 * ENTRY_DELETED with its snapshot (so #261 cache invalidation + search sync
 * prune the live doc); otherwise fire ENTRY_DRAFT_SYNC to prune the draft doc.
 * Then delete the envelope (versions cascade). Shared by the admin and public
 * delete handlers; uses the auto-imported prisma singleton.
 */
export async function deleteEntry(entry: DeletableEntry): Promise<void> {
  const publishedVersion: ContentEntryVersion | null = getPublishedVersion(
    entry.versions
  );
  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (publishedVersion) {
          await enqueueWebhookDeliveries(tx, {
            event: 'ENTRY_DELETED',
            contentType: entry.contentType,
            entry: {
              id: entry.id,
              entryTitle: entry.entryTitle,
              slug: entry.slug,
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: publishedVersion.publishedAt,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              data: publishedVersion.data,
            },
          });
        } else {
          await enqueueEntryDraftSync(tx, {
            contentType: { id: entry.contentType.id },
            entryId: entry.id,
          });
        }
        await tx.contentEntry.delete({ where: { id: entry.id } });
      }),
    { notFoundMessage: 'Content entry not found' }
  );
}
