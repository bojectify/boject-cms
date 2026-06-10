import { meili } from '../utils/meili';
import { resolveEntriesIndex } from '../utils/searchIndex';
import { runSearch } from '../utils/searchEntries';
import {
  SearchInputError,
  type SearchFilter,
} from '../utils/compileSearchFilter';
import { rateLimit } from '../utils/rateLimit';
import { throwRateLimited } from '../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../utils/assertApiKeyScope';
import type { SearchDocument } from '../utils/searchDocument';

const DEFAULT_PER_PAGE = 15;
const MAX_PER_PAGE = 100;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.BOJECT_SEARCH_RATE_LIMIT_RPM) || 120;

/**
 * Parse repeated `filter=field:value` query params into SearchFilters.
 * Each value must split on the FIRST colon (the value half may itself contain
 * colons). A missing/empty field half is a 400 — the field-identifier shape is
 * validated downstream in runSearch (SearchInputError → 400).
 */
function parseFilters(raw: unknown): SearchFilter[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const filters: SearchFilter[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const idx = v.indexOf(':');
    if (idx <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid filter "${v}" — expected "field:value"`,
      });
    }
    filters.push({ field: v.slice(0, idx), value: v.slice(idx + 1) });
  }
  return filters;
}

export default defineEventHandler(async (event) => {
  // Scope gate first: a misconfigured key 403s without consuming the
  // rate-limit budget (mirrors the convention in assertApiKeyScope's doc).
  assertApiKeyScope(event, 'content:read');

  // Rate-limit per api key id when present, falling back to the request IP
  // for session-authed callers. Mirrors the repo's IP-resolution convention
  // (x-forwarded-for header first, then getRequestIP).
  const apiKeyId = event.context.apiKeyId as string | undefined;
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const rateKey = apiKeyId ? `search:key:${apiKeyId}` : `search:ip:${ip}`;
  const snapshot = rateLimit(rateKey, RATE_MAX, RATE_WINDOW_MS);
  if (!snapshot.allowed) {
    throwRateLimited(event, 'search', snapshot.retryAfterMs);
  }

  const query = getQuery(event);
  const q = typeof query.q === 'string' ? query.q : '';
  const contentType =
    typeof query.contentType === 'string' && query.contentType.length > 0
      ? query.contentType
      : undefined;
  const filters = parseFilters(query.filter);

  // A bare request with nothing to search and no scoping is a 400 — Meili would
  // otherwise return the entire index. A filter or contentType is enough to
  // make an empty q meaningful (e.g. "all Articles by author X").
  if (q.length === 0 && !contentType && filters.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'q is required' });
  }

  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Number(query.perPage) || DEFAULT_PER_PAGE)
  );
  const attributesToSearchOn =
    typeof query.attributesToSearchOn === 'string' &&
    query.attributesToSearchOn.length > 0
      ? query.attributesToSearchOn
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  const index = meili.index<SearchDocument>(resolveEntriesIndex());
  try {
    const result = await runSearch(index, {
      q,
      contentType,
      filters,
      attributesToSearchOn,
      offset: (page - 1) * perPage,
      limit: perPage,
    });
    return {
      hits: result.hits,
      total: result.total,
      page,
      perPage,
      processingTimeMs: result.processingTimeMs,
    };
  } catch (err) {
    // Bad input (e.g. a malformed filter field) → 400, never 503.
    if (err instanceof SearchInputError) {
      throw createError({ statusCode: 400, statusMessage: err.message });
    }
    // Anything else is treated as an engine/connectivity failure. Search is a
    // non-essential dependency (graceful degradation), so surface 503 rather
    // than a generic 500 and let the caller back off / fall back.
    console.warn('[search] /api/search failed:', err);
    throw createError({
      statusCode: 503,
      statusMessage: 'Search is temporarily unavailable',
      data: { error: 'SEARCH_UNAVAILABLE' },
    });
  }
});
