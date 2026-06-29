import { assertUuid } from '../../utils/validation';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { validateAndEnrichEntryData } from '../../utils/validateAndEnrichEntryData';
import { publishEntry } from '../../utils/publishEntry';
import {
  isCmsRequest,
  getPublishedVersion,
  getVersionForContext,
  flattenEntryWithVersion,
} from '../../utils/resolveVersion';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';
import { upsertEntryDraft } from '../../utils/upsertEntryDraft';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'entries.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { include: { fields: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  // `entry` is loaded with `contentType: { include: { fields: true } }`,
  // so it is structurally assignable to both DraftableEntry and PublishableEntry.
  // Validate ONCE per path.
  const isPublish = body.status === CONTENT_STATUSES.PUBLISHED;
  const rawData =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : null;

  if (isPublish) {
    const validatedData = rawData
      ? await validateAndEnrichEntryData(entry.contentType, rawData, {
          excludeEntryId: entry.id,
        })
      : null;
    await publishEntry(entry, validatedData);
  } else {
    await upsertEntryDraft(entry, rawData);
  }

  // Re-fetch the updated entry with versions
  const updated = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: {
      versions: true,
      contentType: { include: { fields: { orderBy: { order: 'asc' } } } },
    },
  });

  const isCms = isCmsRequest(event);
  const version = getVersionForContext(updated.versions, isCms);
  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No visible version for this entry',
    });
  }

  const publishedVersion = getPublishedVersion(updated.versions);

  return flattenEntryWithVersion(updated, version, {
    contentType: updated.contentType,
    ...(isCms
      ? {
          hasPublishedVersion: publishedVersion !== null,
          publishedVersionPublishedAt: publishedVersion?.publishedAt ?? null,
        }
      : {}),
  });
});
