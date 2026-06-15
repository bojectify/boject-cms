// Presentation metadata for content-type field types in the ⌘K search palette's
// field-step rows (#369): a leading lucide icon + a compact trailing type label.
//
// Kept OUT of the vendored `fieldTypes.ts` on purpose — that module is byte-synced
// into packages/boject-cli/src/vendor/ (guarded by vendorDrift.test.ts) and the
// CLI has no use for UI icons. This is a pure strings-only module (no Nuxt/Prisma
// deps), so it still ships fine to the Nuxt client + Storybook.
//
// System fields ($status / $id / $entryKey) carry a donor `type`, so they read
// their icon + label from these same maps.
import type { FieldTypeName } from './fieldTypes';

/** Lucide icon id (WITHOUT the `i-lucide-` prefix) per field type. */
export const FIELD_TYPE_ICONS: Record<FieldTypeName, string> = {
  ENTRY_TITLE: 'type',
  SLUG: 'link',
  TEXT: 'text',
  TEXTAREA: 'align-left',
  NUMBER: 'hash',
  BOOLEAN: 'toggle-left',
  DATETIME: 'calendar',
  SELECT: 'square-chevron-down',
  RICHTEXT: 'pilcrow',
  RELATION: 'link-2',
  MULTIRELATION: 'waypoints',
  IMAGE: 'image',
};

/**
 * Compact type label for the 11px field-row pill — shorter than the
 * `FIELD_TYPE_LABELS` used in the field editor (e.g. "Date" not "Date/Time",
 * "Multi-rel" not "Multi Relation") so it stays a tidy badge.
 */
export const FIELD_TYPE_SHORT_LABELS: Record<FieldTypeName, string> = {
  ENTRY_TITLE: 'Entry Title',
  SLUG: 'Slug',
  TEXT: 'Text',
  TEXTAREA: 'Textarea',
  NUMBER: 'Number',
  BOOLEAN: 'Boolean',
  DATETIME: 'Date',
  SELECT: 'Select',
  RICHTEXT: 'Richtext',
  RELATION: 'Relation',
  MULTIRELATION: 'Multi-rel',
  IMAGE: 'Image',
};
