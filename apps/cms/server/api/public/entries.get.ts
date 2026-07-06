import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { rateLimit } from '../../utils/rateLimit';
import { throwRateLimited } from '../../utils/rateLimitEndpoint';
import { resolvePublicContentTypeId } from '../../utils/resolveContentTypeId';
import {
  buildEntryListWhere,
  keysetPage,
  resolveAndFlattenEntries,
  InvalidCursorError,
} from '../../utils/listEntries';
import type { ContentEntry } from '#prisma';
import { withTaggedCache } from '../../utils/withTaggedCache';
import { resolvePublicCacheTtl } from '../../utils/cacheConfig';
import { getClientIp } from '../../utils/clientIp';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.BOJECT_PUBLIC_RATE_LIMIT_RPM) || 120;

export default defineEventHandler(async (event) => {
  // Scope gate first: a misconfigured key 403s without consuming rate budget.
  assertApiKeyScope(event, 'content:read');

  const apiKeyId = event.context.apiKeyId as string | undefined;
  const ip = getClientIp(event);
  const rateKey = apiKeyId ? `public:key:${apiKeyId}` : `public:ip:${ip}`;
  const snapshot = rateLimit(rateKey, RATE_MAX, RATE_WINDOW_MS);
  if (!snapshot.allowed)
    throwRateLimited(event, 'public', snapshot.retryAfterMs);

  const query = getQuery(event);

  // contentType (identifier) required — identifier-only, no UUID input.
  // resolvePublicContentTypeId 400s when contentType is absent and returns null
  // for an unknown identifier → empty page (no enumeration oracle). status ignored.
  const contentTypeId = await resolvePublicContentTypeId(prisma, query);
  if (contentTypeId === null) {
    return { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 25));
  const after = typeof query.after === 'string' ? query.after : null;
  const contentType = String(query.contentType);

  // Cache-aside AFTER auth + rate-limit + content-type resolution (those run on
  // every request, including hits). Key is built from post-normalisation locals
  // → deterministic + instance-independent, shared across API keys
  // (PUBLISHED-only, identical for every caller). Tagged content-type:<id> so
  // #261's subscriber can invalidate exactly this type's cached lists.
  return withTaggedCache(
    event,
    {
      key: `public:entries:${contentType}:perPage=${perPage}:after=${after ?? ''}`,
      tags: [`content-type:${contentType}`],
      ttl: resolvePublicCacheTtl(),
    },
    async () => {
      // PUBLISHED-only by construction (isCms: false → versions.some PUBLISHED).
      const where = buildEntryListWhere({
        isCms: false,
        archiveFilter: 'active',
        contentTypeId,
      });

      let page;
      try {
        page = await keysetPage<ContentEntry>(prisma, { where, perPage, after }); // forward only
      } catch (e) {
        // Malformed-cursor 400 stays INSIDE fn (part of producing the response,
        // must never be cached); h3 errors thrown here propagate uncached.
        if (e instanceof InvalidCursorError) {
          throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' });
        }
        throw e;
      }

      const items = await resolveAndFlattenEntries(prisma, page.rows, {
        isCms: false,
        archiveFilter: 'active',
      });

      return {
        items,
        pageInfo: {
          hasNextPage: page.pageInfo.hasNextPage,
          endCursor: page.pageInfo.endCursor,
        },
      };
    }
  );
});
