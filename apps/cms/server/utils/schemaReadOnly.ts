import type { H3Event } from 'h3';
import { createError } from 'h3';

/**
 * Coerce the BOJECT_SCHEMA_READONLY env var into a boolean.
 * "true" / "1" → true; everything else (including unset) → false.
 *
 * Exported separately from `assertSchemaEditable` so the coercion
 * contract has its own unit test surface — the helper itself runs
 * inside a request and is exercised by integration tests.
 */
export function coerceSchemaReadonly(value: unknown): boolean {
  return value === 'true' || value === '1';
}

/**
 * Throw a 403 if BOJECT_SCHEMA_READONLY is on. Insert as the first
 * line of any handler that mutates content-type or field schema —
 * before rate-limit and CSRF guards, so locked-environment requests
 * don't burn the editor's rate-limit bucket.
 *
 * Content-entry endpoints are deliberately NOT gated. The flag draws
 * a line at "schema editing" only.
 */
export function assertSchemaEditable(event: H3Event): void {
  const config = useRuntimeConfig(event);
  if (config.schemaReadonly === true) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Schema is read-only on this environment',
      data: { error: 'SCHEMA_READONLY' },
    });
  }
}
