// Shared value rule for JSON content-type fields (#497). Pure module (zero
// Nuxt / Prisma / Node deps — runs in the browser editor, the Nitro server,
// tsx bundle scripts, and the CLI) — keep
// packages/boject-cli/src/vendor/jsonFieldValue.ts byte-identical.

/** Maximum serialised size of a JSON field value: 256 KB of UTF-8. */
export const JSON_FIELD_MAX_BYTES = 256 * 1024;

/**
 * Returns an error message (without the field name — callers prefix it) when
 * `value` is not a legal JSON field value, or `null` when it is. A legal value
 * is a JSON object or array at the top level whose `JSON.stringify` output is
 * at most {@link JSON_FIELD_MAX_BYTES} UTF-8 bytes. Callers treat
 * `null`/`undefined` as "empty" before calling; passed here they are rejected.
 */
export function jsonFieldValueError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'must be a JSON object or array';
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > JSON_FIELD_MAX_BYTES) {
    return 'exceeds the 256 KB limit';
  }
  return null;
}
