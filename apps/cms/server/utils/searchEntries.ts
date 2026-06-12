import type { Index } from 'meilisearch';
import type { SearchDocument } from './searchDocument';
import type { FieldTypeName } from '../../utils/fieldTypes';
import {
  compileSearchFilter,
  SearchInputError,
  type SearchFilter,
} from './compileSearchFilter';

// SearchInputError + SearchFilter are owned by compileSearchFilter.ts; consumers
// import them from there directly. We deliberately do NOT re-export them here —
// a re-export would surface the same names from two server/utils modules and
// trip Nuxt's duplicate-auto-import warning.

// Allowed `attributesToSearchOn` values: the envelope title, the whole `fields`
// bucket, or a single nested field path `fields.<camelCase>`. Anything else is
// a caller mistake (would make Meili 400) — reject it up-front as 400, not 503.
const SEARCHABLE_ATTR = /^(entryTitle|fields(\.[a-z][a-zA-Z0-9]*)?)$/;
const CROP_LENGTH = 30;

export interface RunSearchParams {
  q: string;
  /** Content type identifier — compiled to `contentType = "<id>"`. */
  contentType?: string;
  /** Per-field equality constraints, AND-ed together. */
  filters?: SearchFilter[];
  /** field identifier → FieldType, resolved from the scoped content type. */
  fieldTypes?: Record<string, FieldTypeName>;
  /** Restrict the free-text search to these attributes (e.g. `['entryTitle']`). */
  attributesToSearchOn?: string[];
  /** Pre-compiled raw envelope filter clauses (the auth status gate) appended verbatim. */
  envelopeFilters?: string[];
  offset: number;
  limit: number;
}

export interface SearchHit {
  id: string;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  status: string;
  snippet: string | null;
  publishedAt: string | null;
}

export interface RunSearchResult {
  hits: SearchHit[];
  total: number;
  processingTimeMs: number;
}

function buildFilter(params: RunSearchParams): string[] {
  const filter: string[] = [];
  if (params.contentType) {
    filter.push(`contentType = ${quoteContentType(params.contentType)}`);
  }
  const fieldTypes = params.fieldTypes ?? {};
  for (const f of params.filters ?? []) {
    filter.push(compileSearchFilter(f, fieldTypes));
  }
  for (const ef of params.envelopeFilters ?? []) {
    filter.push(ef);
  }
  return filter;
}

// Quote + escape the contentType identifier for its envelope filter literal.
// Intentionally mirrors the compiler's `meiliLiteral` (Meili string-literal
// escaping is a fixed property of the filter grammar) — the contentType clause
// is an envelope filter, deliberately outside compileSearchFilter's per-field
// remit, so it doesn't route through the compiler.
function quoteContentType(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Pick a highlighted/cropped excerpt from Meili's `_formatted` payload. */
function buildSnippet(
  formatted: Partial<SearchDocument> | undefined
): string | null {
  if (!formatted) return null;
  const fields =
    formatted.fields && typeof formatted.fields === 'object'
      ? (formatted.fields as Record<string, unknown>)
      : {};
  // Prefer a body field containing a highlight, then a highlighted title, then
  // any non-empty cropped body field.
  for (const v of Object.values(fields)) {
    if (typeof v === 'string' && v.includes('<em>')) return v;
  }
  if (
    typeof formatted.entryTitle === 'string' &&
    formatted.entryTitle.includes('<em>')
  ) {
    return formatted.entryTitle;
  }
  for (const v of Object.values(fields)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Run a search against the entries index and project engine `SearchHit`s.
 * Pure of HTTP/auth concerns (those live in the REST handler / GraphQL
 * resolver). Throws `SearchInputError` on bad input; rethrows engine errors so
 * the caller can map a connectivity failure to 503.
 */
export async function runSearch(
  index: Index<SearchDocument>,
  params: RunSearchParams
): Promise<RunSearchResult> {
  const filter = buildFilter(params);
  for (const attr of params.attributesToSearchOn ?? []) {
    if (!SEARCHABLE_ATTR.test(attr)) {
      throw new SearchInputError(`Invalid attributesToSearchOn "${attr}"`);
    }
  }
  const res = await index.search(params.q, {
    filter,
    ...(params.attributesToSearchOn
      ? { attributesToSearchOn: params.attributesToSearchOn }
      : {}),
    offset: params.offset,
    limit: params.limit,
    attributesToHighlight: ['entryTitle', 'fields'],
    attributesToCrop: ['entryTitle', 'fields'],
    cropLength: CROP_LENGTH,
  });

  // A snippet is a highlighted excerpt of the free-text match. With filters only
  // (no `q`) there is nothing to highlight, and Meili's crop would surface an
  // arbitrary field value — so omit the snippet entirely unless `q` is present.
  const hasQuery = params.q.trim().length > 0;
  const hits: SearchHit[] = res.hits.map((h) => ({
    id: h.entryId,
    entryKey: h.entryKey,
    contentType: h.contentType,
    entryTitle: h.entryTitle,
    status: h.status,
    publishedAt: h.publishedAt,
    snippet: hasQuery ? buildSnippet(h._formatted) : null,
  }));

  return {
    hits,
    total: res.estimatedTotalHits ?? hits.length,
    processingTimeMs: res.processingTimeMs,
  };
}
