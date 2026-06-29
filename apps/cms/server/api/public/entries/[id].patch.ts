import { assertUuid } from '../../../utils/validation';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import { enforcePublicWriteRateLimit } from '../../../utils/publicWriteRateLimit';
import { mergeEntryPatch } from '../../../utils/mergeEntryPatch';
import { validateAndEnrichEntryData } from '../../../utils/validateAndEnrichEntryData';
import { upsertEntryDraft } from '../../../utils/upsertEntryDraft';
import { publishEntry } from '../../../utils/publishEntry';
import {
  getVersionForContext,
  getDraftVersion,
  getPublishedVersion,
  flattenEntryWithVersion,
} from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforcePublicWriteRateLimit(event);
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = (await readBody<Record<string, unknown>>(event)) ?? {};

  const patch =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : {};

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true, contentType: { include: { fields: true } } },
  });
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Content entry not found' });
  }

  // Base = working version (CHANGED > DRAFT > PUBLISHED).
  const base =
    getDraftVersion(entry.versions) ?? getPublishedVersion(entry.versions);
  const workingData = (base?.data as Record<string, unknown> | undefined) ?? {};
  const merged = mergeEntryPatch(workingData, patch, entry.contentType.fields);

  if (body.publish === true) {
    const validated = await validateAndEnrichEntryData(entry.contentType, merged, {
      excludeEntryId: entry.id,
    });
    await publishEntry(entry, validated);
  } else {
    await upsertEntryDraft(entry, merged);
  }

  const updated = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: {
      versions: true,
      contentType: { include: { fields: { orderBy: { order: 'asc' } } } },
    },
  });
  const version = getVersionForContext(updated.versions, true) ?? updated.versions[0]!;
  return flattenEntryWithVersion(updated, version, {});
});
