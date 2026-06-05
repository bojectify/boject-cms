import type { FieldTypeName } from '../../utils/fieldTypes';

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
