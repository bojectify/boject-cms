import type { Prisma, ContentEntryVersion } from '#prisma';
import { withPrismaErrors } from './prismaErrors';
import { getPublishedVersion, getDraftVersion } from './resolveVersion';
import { enqueueEntryDraftSync } from './webhooks';
import {
  validateAndEnrichEntryData,
  type WriteContentType,
} from './validateAndEnrichEntryData';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

/**
 * The loaded-entry shape this util needs. `contentType` is `WriteContentType`
 * (which carries `unique` on its fields) because validateAndEnrichEntryData →
 * assertUniqueFieldValues requires `unique` at the type level. We deliberately
 * do NOT reuse `PublishableEntry` here — its `contentType.fields` omits
 * `unique`, and widening it would mean touching publishEntry.ts (kept as-is). A
 * full Prisma-loaded entry (admin PUT + public PUT/PATCH all load
 * `contentType: { include: { fields: true } }`) is structurally assignable.
 */
export type DraftableEntry = {
  id: string;
  versions: ContentEntryVersion[];
  contentType: WriteContentType;
};

/**
 * Save a DRAFT/CHANGED version (the non-publish write path). With a PUBLISHED
 * version present → CHANGED; otherwise → DRAFT. `rawData` is validated+enriched
 * here (Option A). `rawData === null` reuses the existing draft's data (the
 * admin PUT's "save with no body" case); with no existing draft that is a 400.
 */
export async function upsertEntryDraft(
  entry: DraftableEntry,
  rawData: Record<string, unknown> | null
): Promise<void> {
  const publishedVersion = getPublishedVersion(entry.versions);
  const draftVersion = getDraftVersion(entry.versions);
  const targetStatus = publishedVersion
    ? CONTENT_STATUSES.CHANGED
    : CONTENT_STATUSES.DRAFT;

  const validated =
    rawData !== null
      ? await validateAndEnrichEntryData(entry.contentType, rawData, {
          excludeEntryId: entry.id,
        })
      : null;

  const dataToSave =
    validated ?? (draftVersion?.data as Record<string, unknown> | null);
  if (!dataToSave) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data provided and no existing draft to update',
    });
  }

  const entryTitle = extractEntryTitle(dataToSave, entry.contentType.fields);
  const slug = extractSlug(dataToSave, entry.contentType.fields);

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (draftVersion) {
          await tx.contentEntryVersion.update({
            where: { id: draftVersion.id },
            data: {
              data: dataToSave as Prisma.InputJsonValue,
              entryTitle,
              status: targetStatus,
            },
          });
        } else {
          await tx.contentEntryVersion.create({
            data: {
              entryId: entry.id,
              data: dataToSave as Prisma.InputJsonValue,
              entryTitle,
              status: targetStatus,
            },
          });
        }
        await tx.contentEntry.update({
          where: { id: entry.id },
          data: { slug, entryTitle },
        });
        await enqueueEntryDraftSync(tx, {
          contentType: { id: entry.contentType.id },
          entryId: entry.id,
        });
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}
