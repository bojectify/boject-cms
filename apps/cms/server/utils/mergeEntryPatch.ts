import { createError } from 'h3';

/**
 * Shallow, field-level overlay of a PATCH body onto an entry's working data.
 * - Absent key  → field left untouched.
 * - Present key → wholesale overwrite (object/array-valued fields replace
 *   entirely — no deep merge; `null` / `''` / `[]` are explicit clears).
 * - Unknown key (no matching field identifier) → h3 400 UNKNOWN_FIELD.
 * Field VALUES are not validated here — the caller runs the merged result
 * through validateAndEnrichEntryData (which enforces required/types and would
 * otherwise silently strip the unknown key, so we reject it up front).
 */
export function mergeEntryPatch(
  workingData: Record<string, unknown>,
  patch: Record<string, unknown>,
  fields: Array<{ identifier: string }>
): Record<string, unknown> {
  const known = new Set(fields.map((f) => f.identifier));
  for (const key of Object.keys(patch)) {
    if (!known.has(key)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown field: ${key}`,
        data: { error: 'UNKNOWN_FIELD', field: key },
      });
    }
  }
  return { ...workingData, ...patch };
}
