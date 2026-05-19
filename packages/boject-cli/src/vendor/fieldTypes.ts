// Canonical registry of dynamic content type field types. Mirrors the
// `FieldType` enum in apps/cms/prisma/schema/contentType.prisma so that
// validators, UI dropdowns, and tests all read from one source. Pure module
// (zero Nuxt / Prisma deps) so it ships unchanged into packages/boject-cli
// via vendor copy — keep packages/boject-cli/src/vendor/fieldTypes.ts in sync.

export const FIELD_TYPES = {
  ENTRY_TITLE: 'ENTRY_TITLE',
  SLUG: 'SLUG',
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  DATETIME: 'DATETIME',
  SELECT: 'SELECT',
  RICHTEXT: 'RICHTEXT',
  RELATION: 'RELATION',
  MULTIRELATION: 'MULTIRELATION',
  IMAGE: 'IMAGE',
} as const;

export const FIELD_TYPE_NAMES = Object.values(FIELD_TYPES);

export type FieldTypeName = (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES];

export const FIELD_TYPES_SET: ReadonlySet<FieldTypeName> = new Set(
  FIELD_TYPE_NAMES
);

export function isFieldTypeName(value: unknown): value is FieldTypeName {
  return (
    typeof value === 'string' && FIELD_TYPES_SET.has(value as FieldTypeName)
  );
}

export const FIELD_TYPE_LABELS: Record<FieldTypeName, string> = {
  ENTRY_TITLE: 'Entry Title',
  SLUG: 'Slug',
  TEXT: 'Text',
  TEXTAREA: 'Textarea',
  NUMBER: 'Number',
  BOOLEAN: 'Boolean',
  DATETIME: 'Date/Time',
  SELECT: 'Select',
  RICHTEXT: 'Rich Text',
  RELATION: 'Relation',
  MULTIRELATION: 'Multi Relation',
  IMAGE: 'Image',
};

export const FIELD_TYPE_OPTIONS: Array<{
  label: string;
  value: FieldTypeName;
}> = FIELD_TYPE_NAMES.map((value) => ({
  label: FIELD_TYPE_LABELS[value],
  value,
}));
