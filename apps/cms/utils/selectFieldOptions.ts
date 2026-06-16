// Entry-editor SELECT "clear" affordance (#374). Pure — no Nuxt/Prisma.

// Reka UI's SelectItem forbids an empty-string value, so an optional SELECT's
// clear choice uses a sentinel that maps back to null. Required SELECTs omit it
// — an empty pick is not a legal value, and `validateEntryData` is the backstop.
export const SELECT_NONE = '__none__';

export interface SelectOption {
  label: string;
  value: string;
}

/**
 * Items for an entry-editor SELECT. Optional fields get a leading "— none —"
 * clear option; required fields omit it.
 */
export function selectItems(
  required: boolean | undefined,
  options: SelectOption[]
): SelectOption[] {
  return required
    ? options
    : [{ label: '— none —', value: SELECT_NONE }, ...options];
}

/**
 * Map a stored SELECT value to the USelect model value: an unset value shows
 * "— none —" (the sentinel) for optional fields, or '' for required fields
 * (which carry no sentinel item).
 */
export function selectModelValue(
  required: boolean | undefined,
  value: unknown
): string {
  if (value === undefined || value === null || value === '') {
    return required ? '' : SELECT_NONE;
  }
  return String(value);
}
