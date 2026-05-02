import type { H3Event } from 'h3';
import { createError } from 'h3';

/**
 * Throw 403 INSUFFICIENT_SCOPE if the request is API-key-authed and
 * the resolved key doesn't carry `scope`. Session-authed requests
 * pass through (CMS users have full authority — scopes are an API
 * key construct only).
 *
 * Auth middleware stashes scopes at event.context.apiKeyScopes during
 * key validation. Handlers call this as the first line of work.
 */
export function assertApiKeyScope(event: H3Event, scope: string): void {
  if (event.context.authMethod !== 'apikey') return;
  const scopes = event.context.apiKeyScopes;
  if (Array.isArray(scopes) && scopes.includes(scope)) return;
  throw createError({
    statusCode: 403,
    statusMessage: `API key missing required scope: ${scope}`,
    data: { error: 'INSUFFICIENT_SCOPE', required: scope },
  });
}
