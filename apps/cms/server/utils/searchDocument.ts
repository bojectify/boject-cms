import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';

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
  id: string;
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
 * recurses into every node's `content`. Each container node emits a single
 * space boundary so words don't fuse across blocks / table cells. Atom nodes
 * with no text — notably `cmsEmbed` — contribute nothing and are thereby
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

    if (typeof n.text === 'string') parts.push(n.text);

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child, depth + 1);
      parts.push(' '); // block boundary
    }
  }

  walk(doc, 0);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Extract a single relation's target entryId, or null if malformed. */
function relationEntryId(value: unknown): string | null {
  const rel = asObject(value);
  return typeof rel.entryId === 'string' && rel.entryId !== ''
    ? rel.entryId
    : null;
}

/**
 * Flatten a CMS entry into a Meilisearch document per the field-type mapping
 * decided in the search epic (#53). Pure — no Prisma, no Nuxt, no I/O.
 *
 * Per field type: TEXT/TEXTAREA/SLUG/SELECT → string; RICHTEXT → flattened
 * plain text; NUMBER → number; BOOLEAN → boolean; DATETIME → ISO string;
 * RELATION → target entryId; MULTIRELATION → target entryId[]; ENTRY_TITLE is
 * folded into the envelope `entryTitle` (not duplicated under `fields`); IMAGE
 * is skipped. Missing / malformed values degrade to null (scalars), '' (rich
 * text), or [] (multirelation) rather than throwing.
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
      case FIELD_TYPES.DATETIME:
        out[field.identifier] = typeof value === 'string' ? value : null;
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
    id: entry.id,
    entryKey: entry.entryKey,
    contentType: entry.contentType,
    entryTitle: entry.entryTitle,
    publishedAt: entry.publishedAt,
    fields: out,
  };
}
