import type { Index } from 'meilisearch';
import type { SearchDocument } from './searchDocument';

// Content-type field identifiers are camelCase (lowercase-first); reject
// anything else so a malformed field 400s rather than silently matching nothing.
const FIELD_ID = /^[a-z][a-zA-Z0-9]*$/;
// Allowed `attributesToSearchOn` values: the envelope title, the whole `fields`
// bucket, or a single nested field path `fields.<camelCase>`. Anything else is
// a caller mistake (would make Meili 400) — reject it up-front as 400, not 503.
const SEARCHABLE_ATTR = /^(entryTitle|fields(\.[a-z][a-zA-Z0-9]*)?)$/;
const CROP_LENGTH = 30;

export interface SearchFilter {
  /** A content-type field identifier (camelCase). Compiled to `fields.<field>`. */
  field: string;
  value: string;
}

export interface RunSearchParams {
  q: string;
  /** Content type identifier — compiled to `contentType = "<id>"`. */
  contentType?: string;
  /** Per-field equality constraints, AND-ed together. */
  filters?: SearchFilter[];
  /** Restrict the free-text search to these attributes (e.g. `['entryTitle']`). */
  attributesToSearchOn?: string[];
  offset: number;
  limit: number;
}

export interface SearchHit {
  id: string;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  snippet: string | null;
  publishedAt: string | null;
}

export interface RunSearchResult {
  hits: SearchHit[];
  total: number;
  processingTimeMs: number;
}

/** Thrown on an invalid field identifier — the REST handler maps it to 400. */
export class SearchInputError extends Error {}

/** Quote + escape a value for a Meili filter literal. */
function meiliLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFilter(params: RunSearchParams): string[] {
  const filter: string[] = [];
  if (params.contentType) {
    filter.push(`contentType = ${meiliLiteral(params.contentType)}`);
  }
  for (const { field, value } of params.filters ?? []) {
    if (!FIELD_ID.test(field)) {
      throw new SearchInputError(`Invalid filter field "${field}"`);
    }
    filter.push(`fields.${field} = ${meiliLiteral(value)}`);
  }
  return filter;
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

  const hits: SearchHit[] = res.hits.map((h) => ({
    id: h.id,
    entryKey: h.entryKey,
    contentType: h.contentType,
    entryTitle: h.entryTitle,
    publishedAt: h.publishedAt,
    snippet: buildSnippet(h._formatted),
  }));

  return {
    hits,
    total: res.estimatedTotalHits ?? hits.length,
    processingTimeMs: res.processingTimeMs,
  };
}
