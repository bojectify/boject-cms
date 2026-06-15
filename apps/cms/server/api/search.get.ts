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
import {
  isOperatorId,
  operatorArity,
} from '../../utils/queryBuilder/operators';
import { resolveContentTypeFieldTypes } from '../utils/searchFieldTypes';
import { isCmsRequest } from '../utils/resolveVersion';
import {
  parseColumnsParam,
  filterColumnableColumns,
} from '../../utils/searchColumns';
import { hydrateRelationColumns } from '../utils/hydrateRelationColumns';

const DEFAULT_PER_PAGE = 15;
const MAX_PER_PAGE = 100;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.BOJECT_SEARCH_RATE_LIMIT_RPM) || 120;

/**
 * Parse repeated `filter=` query params into SearchFilters. Accepts both the
 * 3-part `field:op:value` form and the legacy 2-part `field:value` form (→ eq).
 * Disambiguation: the middle token is treated as the operator only when it is a
 * registered operator id; otherwise the whole remainder is an eq value (so
 * values containing colons, e.g. URLs, are preserved). Multi-value ops
 * (in / containsAny / containsAll / between) comma-separate their values.
 */
function parseFilters(raw: unknown): SearchFilter[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const filters: SearchFilter[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const firstColon = v.indexOf(':');
    if (firstColon <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid filter "${v}" — expected "field:value" or "field:op:value"`,
      });
    }
    const field = v.slice(0, firstColon);
    const rest = v.slice(firstColon + 1);
    const secondColon = rest.indexOf(':');
    if (secondColon > 0) {
      const maybeOp = rest.slice(0, secondColon);
      if (isOperatorId(maybeOp)) {
        const arity = operatorArity(maybeOp);
        const rawValue = rest.slice(secondColon + 1);
        // Nullary ops (is set / is not set) carry no value; list ops are
        // comma-separated.
        const vals =
          arity === 'zero'
            ? []
            : arity === 'one'
              ? [rawValue]
              : rawValue.split(',');
        filters.push({ field, op: maybeOp, values: vals });
        continue;
      }
    }
    // Legacy 2-part, or a value that contains colons but no registered op prefix.
    filters.push({ field, op: 'eq', values: [rest] });
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
  // make an empty q meaningful (e.g. "all Articles by author X"). This guard
  // deliberately reads the ORIGINAL parsed `filters` (pre-gate) so an API-key
  // request carrying only `$status` still passes before the gate strips it.
  if (q.length === 0 && !contentType && filters.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'q is required' });
  }

  // Auth-context status gate. API keys (and any non-session caller) are forced
  // to PUBLISHED — drafts never leak. A CMS session always sees the working
  // (editor-visible) version per entry, so a $status filter matches the entry's
  // EDITORIAL status (DRAFT/CHANGED/PUBLISHED), not a shadowed version: a
  // CHANGED entry (CHANGED working doc + a shadowed PUBLISHED doc) must NOT
  // surface under $status=PUBLISHED via its shadowed PUBLISHED doc.
  const isCms = isCmsRequest(event);
  let effectiveFilters = filters;
  let envelopeFilters: string[];
  if (!isCms) {
    effectiveFilters = filters.filter((f) => f.field !== '$status');
    envelopeFilters = ['status = "PUBLISHED"'];
  } else {
    envelopeFilters = ['isWorkingVersion = true'];
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

  const requestedColumns = parseColumnsParam(query.columns);

  // Field types are needed to compile structured filters AND to validate /
  // hydrate columns; resolve once when a type is scoped and either is present.
  const fieldTypes =
    contentType && (effectiveFilters.length > 0 || requestedColumns.length > 0)
      ? await resolveContentTypeFieldTypes(contentType)
      : {};

  // Columns are only honoured for a single scoped type; unknown / non-columnable
  // ids are silently dropped (a removed field must not 400 a shared link).
  const columns = contentType
    ? filterColumnableColumns(requestedColumns, fieldTypes)
    : [];

  const index = meili.index<SearchDocument>(resolveEntriesIndex());
  try {
    const result = await runSearch(index, {
      q,
      contentType,
      filters: effectiveFilters,
      fieldTypes,
      attributesToSearchOn,
      envelopeFilters,
      columns,
      offset: (page - 1) * perPage,
      limit: perPage,
    });
    // A Postgres failure here folds into the catch below as 503
    // SEARCH_UNAVAILABLE. Intentional: it's a cheap indexed findMany-by-PK, so a
    // failure means the DB is down — where a retryable 503 is a reasonable signal.
    await hydrateRelationColumns(result.hits, columns, fieldTypes);
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
