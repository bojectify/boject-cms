import type { H3Event } from 'h3';
import { createError } from 'h3';

/**
 * Throw 403 INSUFFICIENT_SCOPE if the request is API-key-authed and
 * the resolved key doesn't carry `scope`. Session-authed requests
 * pass through (CMS users have full authority — scopes are an API
 * key construct only).
 *
 * Auth middleware stashes scopes at event.context.apiKeyScopes during
 * key validation.
 *
 * ## Handler-call ordering convention
 *
 * Call this BEFORE `enforceMutationRateLimit`. A caller missing the
 * required scope is invariably misconfigured (wrong key, or a key
 * minted with the wrong scopes) — retries won't help, so pre-charging
 * the rate-limit bucket is unfriendly. Scope-first means a missing
 * scope returns immediate 403 without consuming the caller's per-IP
 * mutation budget. Both checks are constant-time, so there's no
 * performance trade-off to weigh against the cleaner semantics.
 *
 * ## The (i)-rule — apikey:write self-replication
 *
 * The `apikey:write` scope has a special restriction enforced
 * separately in `apps/cms/server/api/apikeys/index.post.ts`: an
 * api-key caller cannot mint another key carrying `apikey:write`.
 * Only session-authed callers (CMS users) can self-replicate that
 * scope. This caps the blast radius of a leaked CLI key — a key with
 * `apikey:write` can still revoke other keys and mint keys with
 * lesser scopes, but it can't bootstrap a successor with the same
 * privilege.
 *
 * No other scope carries this restriction. `content:write` exercises
 * a privilege; `apikey:write` is the self-replication primitive, so
 * its restriction lives at the auth boundary rather than as a
 * per-scope general rule. See CLAUDE.md ("The (i) constraint") for
 * the longer rationale.
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
