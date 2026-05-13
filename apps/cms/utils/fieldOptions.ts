import { z } from 'zod';
import type { FieldType } from '#prisma';

/**
 * Per-branch schemas. Exported so tests and edge-case consumers (e.g. CRUD
 * endpoints adding stricter `.length >= 1` constraints) can use them directly.
 *
 * `.default([])` on every array preserves today's behavior: null options,
 * missing keys, and explicitly empty arrays all parse to "no allow-list
 * configured." `z.string().uuid()` is intentional — persisted data is
 * UUID-validated on the write path, so malformed UUIDs at read-time mean
 * data corruption and we want to fail loudly.
 *
 * Extra keys not declared in the schema are silently dropped (z.object's
 * default behavior). We favour forward-compatibility over stowaway
 * detection here — a future field-options key can be added without
 * breaking older readers.
 */
export const SelectOptionsSchema = z.object({
  choices: z.array(z.string()).default([]),
});

export const RelationOptionsSchema = z.object({
  targetContentTypeIds: z.array(z.string().uuid()).default([]),
});

export const RichtextOptionsSchema = z.object({
  targetContentTypeIds: z.array(z.string().uuid()).default([]),
  linkTargetContentTypeIds: z.array(z.string().uuid()).default([]),
});

/**
 * Discriminated union returned by `parseFieldOptions`. The `type` property
 * is synthesised from the input field's `type` column so consumers can
 * narrow with `switch (opts.type)` without threading the column separately.
 */
export type FieldOptions =
  | { type: 'SELECT'; choices: string[] }
  | { type: 'RELATION'; targetContentTypeIds: string[] }
  | { type: 'MULTIRELATION'; targetContentTypeIds: string[] }
  | {
      type: 'RICHTEXT';
      targetContentTypeIds: string[];
      linkTargetContentTypeIds: string[];
    }
  | {
      type:
        | 'TEXT'
        | 'TEXTAREA'
        | 'NUMBER'
        | 'BOOLEAN'
        | 'DATETIME'
        | 'IMAGE'
        | 'ENTRY_TITLE'
        | 'SLUG';
    };

const NO_PAYLOAD_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'IMAGE',
  'ENTRY_TITLE',
  'SLUG',
] as const;

type NoPayloadFieldType = (typeof NO_PAYLOAD_FIELD_TYPES)[number];

function assertNoPayloadFieldType(type: string): NoPayloadFieldType {
  if ((NO_PAYLOAD_FIELD_TYPES as readonly string[]).includes(type)) {
    return type as NoPayloadFieldType;
  }
  throw new Error(
    `parseFieldOptions: unknown field type '${type}' (expected one of ${[
      'SELECT',
      'RELATION',
      'MULTIRELATION',
      'RICHTEXT',
      ...NO_PAYLOAD_FIELD_TYPES,
    ].join(', ')})`
  );
}

/**
 * Inspect a thrown error from `parseFieldOptions` and extract the
 * structural information CRUD endpoints need to map zod failures back
 * to their existing status-message format:
 * - `key`: which allow-list key the first issue is on, defaulting to
 *   `'targetContentTypeIds'` when not pinpointable.
 * - `code`: `'invalid_type'` if the failure is a shape mismatch
 *   (e.g. non-array), `'invalid_uuid'` otherwise.
 *
 * Returns `undefined` if the error doesn't look like a zod ZodError.
 * Callers should treat that as "unexpected — rethrow or surface as-is".
 *
 * Only valid for RELATION / MULTIRELATION / RICHTEXT error shapes — the
 * `key` default of `targetContentTypeIds` doesn't apply to SELECT (whose
 * only allow-list-shaped key is `choices`); SELECT CRUD paths don't use
 * this helper.
 */
export function getFieldOptionsErrorShape(e: unknown):
  | {
      key: 'targetContentTypeIds' | 'linkTargetContentTypeIds';
      code: 'invalid_type' | 'invalid_uuid';
    }
  | undefined {
  const issues = (
    e as { issues?: Array<{ path: (string | number)[]; code?: string }> }
  ).issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const firstPath = issues[0]?.path[0];
  const key =
    firstPath === 'targetContentTypeIds' ||
    firstPath === 'linkTargetContentTypeIds'
      ? firstPath
      : 'targetContentTypeIds';
  const code =
    issues[0]?.code === 'invalid_type' ? 'invalid_type' : 'invalid_uuid';
  return { key, code };
}

/**
 * Parse a field row's `options` blob into a typed discriminated union.
 *
 * Replaces the `field.options as { ... }` cast pattern scattered across
 * the validator, CRUD endpoints, GraphQL resolvers, and UI mapper.
 * Throws on shape violations (malformed UUIDs, non-string choices) so
 * data corruption surfaces loudly rather than silently filtering.
 *
 * Tolerates `null` and `undefined` `options` by treating them as `{}`,
 * which then lets the per-branch schema defaults kick in.
 */
export function parseFieldOptions(field: {
  type: FieldType | string;
  options: unknown;
}): FieldOptions {
  const raw = field.options ?? {};
  switch (field.type) {
    case 'SELECT':
      return { type: 'SELECT', ...SelectOptionsSchema.parse(raw) };
    case 'RELATION':
      return { type: 'RELATION', ...RelationOptionsSchema.parse(raw) };
    case 'MULTIRELATION':
      return { type: 'MULTIRELATION', ...RelationOptionsSchema.parse(raw) };
    case 'RICHTEXT':
      return { type: 'RICHTEXT', ...RichtextOptionsSchema.parse(raw) };
    default:
      return { type: assertNoPayloadFieldType(field.type) };
  }
}
