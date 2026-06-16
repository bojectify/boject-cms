import type { FieldType } from '#prisma';
import { parseFieldOptions } from './fieldOptions';
import { FIELD_TYPES } from './fieldTypes';

interface FieldDef {
  identifier: string;
  type: FieldType | string;
  options: unknown;
}

// Field types that may carry an `options.default` (#344).
const DEFAULT_SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  FIELD_TYPES.BOOLEAN,
  FIELD_TYPES.NUMBER,
  FIELD_TYPES.SELECT,
]);

/**
 * Pure validation of a field's configured `options.default` (#344). Returns an
 * error message string when the default config is invalid, or `null` when it is
 * fine. Shared by the server `validateFieldDefault` (which maps the message to a
 * 400) and the schema applier (which maps it to a `SchemaApplyValidationError`),
 * so the CMS UI, the field REST API, and schema-as-code import all enforce the
 * same contract. Pure — no Prisma, no h3.
 *
 * Rules:
 * - a `default` on a type that doesn't support one is rejected;
 * - a `default` that fails the per-type zod rules (wrong type, or a SELECT
 *   default outside `choices`) is rejected;
 * - a required BOOLEAN with no default is rejected — "None" is not a legal
 *   value for a required field, so it must default to True or False.
 */
export function checkFieldDefault(
  type: FieldType | string,
  options: unknown,
  required = false
): string | null {
  const hasDefault =
    !!options &&
    typeof options === 'object' &&
    'default' in (options as Record<string, unknown>) &&
    (options as Record<string, unknown>).default !== undefined;

  if (type === FIELD_TYPES.BOOLEAN && required && !hasDefault) {
    return 'A required BOOLEAN field must define a default value of true or false';
  }
  if (!hasDefault) return null;

  if (!DEFAULT_SUPPORTED_TYPES.has(type as string)) {
    return `Default values are not supported on ${type} fields`;
  }
  try {
    parseFieldOptions({ type, options });
  } catch {
    return `Invalid default value for ${type} field`;
  }
  return null;
}

/**
 * The configured default value for each BOOLEAN / NUMBER / SELECT field that has
 * one, keyed by field identifier (#344). Pure. Shared by the new-entry editor
 * pre-fill and the create-time `applyFieldDefaults` seed.
 */
export function defaultsForFields(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const opts = parseFieldOptions(field);
    if (
      (opts.type === 'BOOLEAN' ||
        opts.type === 'NUMBER' ||
        opts.type === 'SELECT') &&
      opts.default !== undefined
    ) {
      out[field.identifier] = opts.default;
    }
  }
  return out;
}
