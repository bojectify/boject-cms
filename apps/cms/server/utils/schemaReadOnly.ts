import type { H3Event } from 'h3';
import { createError } from 'h3';

import { isSchemaReadonly } from '../../utils/schemaReadonly';

/**
 * Throw a 403 if BOJECT_SCHEMA_READONLY is on. Insert as the first
 * line of any handler that mutates content-type or field schema —
 * before rate-limit and CSRF guards, so locked-environment requests
 * don't burn the editor's rate-limit bucket.
 *
 * Content-entry endpoints are deliberately NOT gated. The flag draws
 * a line at "schema editing" only.
 */
export function assertSchemaEditable(_event: H3Event): void {
  // Read the env per request, not runtimeConfig — see utils/schemaReadonly.ts
  // (#527: the published image baked runtimeConfig.schemaReadonly to false).
  if (isSchemaReadonly(process.env)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Schema is read-only on this environment',
      data: { error: 'SCHEMA_READONLY' },
    });
  }
}
