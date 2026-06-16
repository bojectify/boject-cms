import type { FieldType } from '#prisma';
import { defaultsForFields } from '../../utils/fieldDefaults';

interface FieldDef {
  identifier: string;
  type: FieldType | string;
  options: unknown;
}

/**
 * Apply per-field default values at entry CREATE (#344). Returns a shallow copy
 * of `data` where every BOOLEAN / NUMBER / SELECT field that is ABSENT from the
 * payload (key missing or `undefined`) is seeded with its configured
 * `options.default`. A present-but-empty value (`null` / `''`) is left
 * untouched — that is an explicit clear, respected per the spec's Model 1.
 *
 * Pure: never mutates `data`. Call ONLY on the create path (not update).
 */
export function applyFieldDefaults(
  data: Record<string, unknown>,
  fields: FieldDef[]
): Record<string, unknown> {
  const defaults = defaultsForFields(fields);
  const out = { ...data };
  for (const id of Object.keys(defaults)) {
    if (!(id in out) || out[id] === undefined) out[id] = defaults[id];
  }
  return out;
}
