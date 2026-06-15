import type { FieldType } from '#prisma';
import { parseFieldOptions } from './fieldOptions';

interface FieldDef {
  identifier: string;
  type: FieldType | string;
  options: unknown;
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
