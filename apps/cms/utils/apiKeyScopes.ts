/**
 * Canonical registry of recognised API-key scopes.
 *
 * Pure module — zero Nuxt or Prisma dependencies — so it runs in the
 * Nuxt client (#166 admin UI), the Nuxt server (REST endpoint
 * validation), and `tsx`-run scripts (manage-api-keys).
 */
export const API_KEY_SCOPES = [
  'content:read',
  'schema:read',
  'schema:write',
  'apikey:read',
  'apikey:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPES_SET: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && API_KEY_SCOPES_SET.has(value);
}

export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  'content:read': 'Read content via GraphQL.',
  'schema:read': 'Export the schema bundle.',
  'schema:write': 'Apply schema changes.',
  'apikey:read': 'List API keys.',
  'apikey:write': 'Create and revoke API keys.',
};
