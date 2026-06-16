import { createError } from 'h3';
import type { FieldType } from '#prisma';
import { checkFieldDefault } from '../../utils/fieldDefaults';

/**
 * Validate a field's configured `options.default` (#344): reject a default on an
 * unsupported field type, a default that fails the per-type zod rules (wrong
 * type, or a SELECT default outside `choices`), and a required BOOLEAN left
 * without a True/False default. Throws a 400 on any violation. Thin h3 wrapper
 * over the pure `checkFieldDefault` core (shared with the schema applier).
 */
export function validateFieldDefault(
  type: FieldType | string,
  options: unknown,
  required = false
): void {
  const message = checkFieldDefault(type, options, required);
  if (message) {
    throw createError({ statusCode: 400, statusMessage: message });
  }
}
