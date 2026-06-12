import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { isUuid } from '../../utils/validation';
import { publishEntry } from '../../utils/publishEntry';

const MAX_BULK_IDS = 100;

interface BulkPublishResultRow {
  id: string;
  ok: boolean;
  error?: string;
}

function classifyError(err: unknown): string {
  const e = err as { statusCode?: number };
  if (e?.statusCode === 400) return 'NOTHING_TO_PUBLISH';
  if (e?.statusCode === 409) return 'UNIQUE_CONFLICT';
  return 'UNKNOWN';
}

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'content-entries.bulk-publish');

  const body = await readBody<{ ids?: unknown }>(event);
  const raw = Array.isArray(body?.ids) ? body.ids : null;
  if (!raw || raw.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ids must be a non-empty array',
    });
  }
  const ids = [
    ...new Set(
      raw.filter((x): x is string => typeof x === 'string' && isUuid(x))
    ),
  ];
  if (ids.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ids must contain at least one valid UUID',
    });
  }
  if (ids.length > MAX_BULK_IDS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Cannot publish more than ${MAX_BULK_IDS} entries at once`,
    });
  }

  const results: BulkPublishResultRow[] = [];
  for (const id of ids) {
    try {
      const entry = await prisma.contentEntry.findUnique({
        where: { id },
        include: { versions: true, contentType: { include: { fields: true } } },
      });
      if (!entry) {
        results.push({ id, ok: false, error: 'NOT_FOUND' });
        continue;
      }
      await publishEntry(entry);
      results.push({ id, ok: true });
    } catch (err) {
      const error = classifyError(err);
      if (error === 'UNKNOWN') {
        console.error(
          '[bulk-publish] unexpected error publishing entry',
          id,
          err
        );
      }
      results.push({ id, ok: false, error });
    }
  }

  const published = results.filter((r) => r.ok).length;
  return { results, published, failed: results.length - published };
});
