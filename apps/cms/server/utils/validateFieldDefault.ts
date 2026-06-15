import { createError } from 'h3';
import type { FieldType } from '#prisma';
import { parseFieldOptions } from '../../utils/fieldOptions';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const DEFAULT_SUPPORTED: ReadonlySet<string> = new Set([
  FIELD_TYPES.BOOLEAN,
  FIELD_TYPES.NUMBER,
  FIELD_TYPES.SELECT,
]);

/**
 * Validate a field's configured `options.default` (#344): reject a default on an
 * unsupported field type, and reject a default that fails the per-type zod rules
 * (wrong type, or a SELECT default outside `choices`). No-op when `options` has
 * no `default`. Throws a 400 on any violation.
 */
export function validateFieldDefault(
  type: FieldType | string,
  options: unknown
): void {
  const hasDefault =
    !!options &&
    typeof options === 'object' &&
    'default' in (options as Record<string, unknown>) &&
    (options as Record<string, unknown>).default !== undefined;
  if (!hasDefault) return;

  if (!DEFAULT_SUPPORTED.has(type as string)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Default values are not supported on ${type} fields`,
    });
  }
  try {
    parseFieldOptions({ type, options });
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid default value for ${type} field`,
    });
  }
}
