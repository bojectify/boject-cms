import type { Prisma, ContentEntryVersion, FieldType } from '#prisma';
import { withPrismaErrors } from './prismaErrors';
import { enqueueWebhookDeliveries } from './webhooks';
import { getPublishedVersion, getDraftVersion } from './resolveVersion';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

/**
 * The loaded-entry shape the publish flow needs: the envelope, all versions, and
 * the content type's fields. Both the single-entry PUT and the bulk-publish
 * endpoint load exactly this via `include: { versions: true, contentType: { include: { fields: true } } }`.
 */
export type PublishableEntry = {
  id: string;
  slug: string | null;
  createdAt: Date;
  updatedAt: Date;
  contentTypeId: string;
  versions: ContentEntryVersion[];
  contentType: {
    id: string;
    identifier: string;
    fields: Array<{
      id: string;
      identifier: string;
      name: string;
      type: FieldType;
      required: boolean;
      options: unknown;
      order: number;
    }>;
  };
};

/**
 * Publish an entry: in one transaction, drop the old PUBLISHED version (partial
 * unique index), promote the draft (or create a new PUBLISHED version), update
 * the envelope slug/title, and enqueue ENTRY_PUBLISHED (→ internal search-sync).
 * `validatedData` overrides the published data (the PUT path passes the request
 * body's validated data); bulk publish passes nothing and publishes the entry's
 * existing draft/version as-is. Throws (h3 400) if there is nothing to publish.
 * Uses the auto-imported `prisma` singleton.
 */
export async function publishEntry(
  entry: PublishableEntry,
  validatedData: Record<string, unknown> | null = null
): Promise<void> {
  const publishedVersion = getPublishedVersion(entry.versions);
  const draftVersion = getDraftVersion(entry.versions);

  const dataToPublish =
    validatedData ??
    (draftVersion?.data as Record<string, unknown> | null) ??
    (publishedVersion?.data as Record<string, unknown> | null);
  if (!dataToPublish) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data provided and no existing version to publish',
    });
  }

  const entryTitle = extractEntryTitle(dataToPublish, entry.contentType.fields);
  const slug = extractSlug(dataToPublish, entry.contentType.fields);
  const now = new Date();
  const publishedAt = publishedVersion?.publishedAt ?? now;

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (publishedVersion) {
          await tx.contentEntryVersion.delete({
            where: { id: publishedVersion.id },
          });
        }

        if (draftVersion) {
          await tx.contentEntryVersion.update({
            where: { id: draftVersion.id },
            data: {
              data: (validatedData ??
                draftVersion.data) as Prisma.InputJsonValue,
              entryTitle,
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt,
            },
          });
        } else {
          await tx.contentEntryVersion.create({
            data: {
              entryId: entry.id,
              data: dataToPublish as Prisma.InputJsonValue,
              entryTitle,
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt,
            },
          });
        }

        await tx.contentEntry.update({
          where: { id: entry.id },
          data: { slug, entryTitle },
        });

        const published = await tx.contentEntryVersion.findFirstOrThrow({
          where: { entryId: entry.id, status: CONTENT_STATUSES.PUBLISHED },
        });
        await enqueueWebhookDeliveries(tx, {
          event: 'ENTRY_PUBLISHED',
          contentType: {
            id: entry.contentType.id,
            identifier: entry.contentType.identifier,
          },
          entry: {
            id: entry.id,
            entryTitle,
            slug,
            status: CONTENT_STATUSES.PUBLISHED,
            publishedAt: published.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: new Date(),
            data: published.data,
          },
        });
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}
