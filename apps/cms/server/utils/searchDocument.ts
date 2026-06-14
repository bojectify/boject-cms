import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';
import type { ContentStatusName } from '../../utils/contentStatus';

/** A value that can appear under a SearchDocument's `fields` map. */
export type SearchFieldValue = string | number | boolean | string[] | null;

/** The minimal field definition the transformer needs: identifier + type. */
export interface SearchableFieldDef {
  identifier: string;
  type: FieldTypeName;
}

/** The minimal entry shape the transformer consumes (envelope + JSONB data). */
export interface SearchableEntry {
  id: string;
  entryKey: string;
  /** The content type's PascalCase identifier (the `contentType` filter scope). */
  contentType: string;
  entryTitle: string;
  /** ISO-8601 string, or null if never published. */
  publishedAt: string | null;
  /** The version's status (DRAFT/CHANGED/PUBLISHED) — drives the doc key + filter. */
  status: ContentStatusName;
  /** True for the version the editor would see (draft-priority); false for the PUBLISHED doc shadowed by a CHANGED draft. */
  isWorkingVersion: boolean;
  /** The entry version's JSONB `data` blob (guarded internally). */
  data: unknown;
}

/**
 * A flattened, JSON-serialisable Meilisearch document. Envelope fields are
 * top-level; per-field content values nest under `fields` keyed by field
 * identifier. Nesting avoids collisions between a user-defined field identifier
 * (which can legally be `contentType`, `entryTitle`, etc.) and the reserved
 * envelope keys, and keeps a clean envelope/content boundary for downstream
 * settings (#225 sync / #227 query expose `fields.<id>` paths).
 */
export interface SearchDocument {
  /** Primary key: `${entryId}__${status}`. */
  id: string;
  entryId: string;
  status: ContentStatusName;
  isWorkingVersion: boolean;
  entryKey: string;
  contentType: string;
  entryTitle: string;
  publishedAt: string | null;
  fields: Record<string, SearchFieldValue>;
}

const MAX_RICHTEXT_DEPTH = 1000;

/**
 * Flatten a ProseMirror (Tiptap) document to clean plain text for indexing.
 *
 * Keeps the `text` of every text node (so the visible text of `cmsLink`,
 * external-link, and formatting marks survives — marks wrap text nodes) and
 * recurses into every node's `content`. Each non-text node — a container OR a
 * void leaf like `hardBreak` — emits a single space boundary so words don't
 * fuse across blocks, table cells, or inline breaks. Atom nodes with no text —
 * notably `cmsEmbed` — contribute nothing and are thereby
 * stripped. Whitespace runs collapse to one space; the result is trimmed.
 * Recursion is capped at depth 1000 (matching `collectRichtextReferences`);
 * any non-object input yields an empty string.
 */
export function richtextToPlainText(doc: unknown): string {
  const parts: string[] = [];

  function walk(node: unknown, depth: number): void {
    if (depth > MAX_RICHTEXT_DEPTH) return;
    if (!node || typeof node !== 'object') return;
    const n = node as { text?: unknown; content?: unknown };

    if (typeof n.text === 'string') {
      // Text nodes are leaves; emit no boundary so inline text flows naturally
      // (mark-wrapped link / bold text stays joined to its surroundings).
      parts.push(n.text);
      return;
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child, depth + 1);
    }
    // Any non-text node — a container (block / table cell) OR a void leaf
    // (hardBreak, horizontalRule, a cmsEmbed atom) — emits a single space
    // boundary so words don't fuse across blocks, cells, or inline breaks.
    // Redundant spaces are collapsed away below.
    parts.push(' ');
  }

  walk(doc, 0);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Extract a single relation's target entryId, or null if malformed. Only the
 * entryId is kept: it is a globally unique UUID, so it alone facets "entries
 * relating to X", and the field's own targetContentTypeIds already scopes the
 * type — matching how the GraphQL relation filters compare on entryId
 * (jsonbFilters.ts). contentTypeId is intentionally dropped.
 */
export function relationEntryId(value: unknown): string | null {
  const rel = asObject(value);
  return typeof rel.entryId === 'string' && rel.entryId !== ''
    ? rel.entryId
    : null;
}

/**
 * Convert a stored DATETIME value (ISO-8601 string) to epoch milliseconds for
 * indexing. Meilisearch comparison operators (`<`, `>`, `TO`) work only on
 * numbers, so DATETIME is indexed numerically rather than as a sortable-but-
 * not-comparable string. Shared by the index transformer and (later) the query
 * compiler so both agree on the unit. Returns null for missing / malformed
 * values (degrade, never throw).
 */
export function datetimeToEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The Meilisearch primary-key value for one entry version. Meili doc ids only
 * allow [A-Za-z0-9_-], so the delimiter is `__` (a `:` is rejected). Status is a
 * fixed enum with no underscore, so the split is unambiguous.
 */
export function searchDocId(entryId: string, status: string): string {
  return `${entryId}__${status}`;
}

/**
 * Flatten a CMS entry into a Meilisearch document per the field-type mapping
 * decided in the search epic (#53). Pure — no Prisma, no Nuxt, no I/O.
 *
 * Per field type: TEXT/TEXTAREA/SLUG/SELECT → string; RICHTEXT → flattened
 * plain text; NUMBER → number; BOOLEAN → boolean; DATETIME → epoch
 * milliseconds; RELATION → target entryId; MULTIRELATION → target entryId[];
 * ENTRY_TITLE is folded into the envelope `entryTitle` (not duplicated under
 * `fields`); IMAGE is skipped. Missing / malformed values degrade to null
 * (scalars), '' (rich text), or [] (multirelation) rather than throwing.
 */
export function toSearchDocument(
  entry: SearchableEntry,
  fields: SearchableFieldDef[]
): SearchDocument {
  const data = asObject(entry.data);
  const out: Record<string, SearchFieldValue> = {};

  for (const field of fields) {
    const value = data[field.identifier];

    switch (field.type) {
      case FIELD_TYPES.ENTRY_TITLE:
      case FIELD_TYPES.IMAGE:
        // ENTRY_TITLE is carried by the envelope `entryTitle`; IMAGE is skipped.
        break;

      case FIELD_TYPES.TEXT:
      case FIELD_TYPES.TEXTAREA:
      case FIELD_TYPES.SLUG:
      case FIELD_TYPES.SELECT:
        out[field.identifier] = typeof value === 'string' ? value : null;
        break;

      case FIELD_TYPES.DATETIME:
        out[field.identifier] = datetimeToEpoch(value);
        break;

      case FIELD_TYPES.NUMBER:
        out[field.identifier] =
          typeof value === 'number' && Number.isFinite(value) ? value : null;
        break;

      case FIELD_TYPES.BOOLEAN:
        out[field.identifier] = typeof value === 'boolean' ? value : null;
        break;

      case FIELD_TYPES.RICHTEXT:
        out[field.identifier] = richtextToPlainText(value);
        break;

      case FIELD_TYPES.RELATION:
        out[field.identifier] = relationEntryId(value);
        break;

      case FIELD_TYPES.MULTIRELATION:
        out[field.identifier] = Array.isArray(value)
          ? value.map(relationEntryId).filter((id): id is string => id !== null)
          : [];
        break;

      default:
        // Unknown field type: index nothing for it (forward-compatible).
        break;
    }
  }

  return {
    id: searchDocId(entry.id, entry.status),
    entryId: entry.id,
    status: entry.status,
    isWorkingVersion: entry.isWorkingVersion,
    entryKey: entry.entryKey,
    contentType: entry.contentType,
    entryTitle: entry.entryTitle,
    publishedAt: entry.publishedAt,
    fields: out,
  };
}
