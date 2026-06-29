import { assertUuid } from '../../../utils/validation';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import { enforcePublicWriteRateLimit } from '../../../utils/publicWriteRateLimit';
import { validateAndEnrichEntryData } from '../../../utils/validateAndEnrichEntryData';
import { upsertEntryDraft } from '../../../utils/upsertEntryDraft';
import { publishEntry } from '../../../utils/publishEntry';
import { flattenEntryWithVersion, getVersionForContext } from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforcePublicWriteRateLimit(event);
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = (await readBody<Record<string, unknown>>(event)) ?? {};

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true, contentType: { include: { fields: true } } },
  });
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Content entry not found' });
  }

  const rawData =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : {};

  if (body.publish === true) {
    const validated = await validateAndEnrichEntryData(entry.contentType, rawData, { excludeEntryId: entry.id });
    await publishEntry(entry, validated);
  } else {
    await upsertEntryDraft(entry, rawData);
  }

  const updated = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: { include: { fields: { orderBy: { order: 'asc' } } } } },
  });
  // Token-only surface ⇒ PUBLISHED-priority working version is fine; we return
  // the just-written version. getVersionForContext(..., false) = PUBLISHED-only,
  // but a draft write has no PUBLISHED row to return, so resolve draft-first here.
  const version =
    getVersionForContext(updated.versions, true) /* working version */ ?? updated.versions[0]!;
  return flattenEntryWithVersion(updated, version, {});
});
