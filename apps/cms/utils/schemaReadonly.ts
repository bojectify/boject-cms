/**
 * BOJECT_SCHEMA_READONLY, read from the environment at the moment it's
 * needed (#527). Shared by the server guard
 * (server/utils/schemaReadOnly.ts::assertSchemaEditable) and the UI
 * composable (useSchemaReadonly, which reads it during SSR).
 *
 * Deliberately NOT a `runtimeConfig` key: Nuxt fills runtimeConfig from
 * nuxt.config.ts when the image is BUILT, and only `NUXT_*` env names can
 * override it at runtime — so the published image baked the flag to `false`.
 *
 * Pure: no Nuxt/Nitro imports.
 */

/** "true" / "1" → true; everything else (including unset) → false. */
export function coerceSchemaReadonly(value: unknown): boolean {
  return value === 'true' || value === '1';
}

export function isSchemaReadonly(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return coerceSchemaReadonly(env.BOJECT_SCHEMA_READONLY);
}
