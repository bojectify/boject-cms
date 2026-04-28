# GraphQL rate limit (per API key)

## Overview

Apply a per-API-key sliding-window rate limit to `/api/graphql` in production. Threshold: **1000 requests per second per API key**, derived from the load-test report at `perf/reports/2026-04-28-e869073/summary.md`. The cap is conservative — Scenario 1B held p99 < 9 ms with 0% errors all the way up to the test ceiling of 2000 RPS, so 1000 leaves >2× headroom against measured behaviour.

This ticket (#121) is the foundation. Two follow-up tickets layer on top without reorganising what we land here:

- **#123** adds `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers (and GraphQL `extensions` payload).
- **#124** enriches the 429 response body with `retryAfter` and consumer-guidance `suggestion` strings.

#122 (per-operation query-cost scoring) is independent of this work.

## Approach

**Reuse `apps/cms/server/utils/rateLimit.ts`** — the existing sliding-window helper with `resetRateLimitStore()` for tests. Same primitive that backs `enforceMutationRateLimit`.

**Add a sibling helper in `rateLimitEndpoint.ts`** rather than refactor the file into a generic core. Two callers (mutations + GraphQL) doesn't justify an abstraction; the parallel structure also keeps the 429 surface easy to migrate when #124 lands.

**Strict 1-second sliding window of 1000 requests.** Matches the literal "1000 RPS" framing from the report and protects against burst behaviour — a client that briefly bursts to 1500 RPS gets 500 requests rejected with `Retry-After ≈ 1s` and recovers cleanly as the window slides forward. Rolling 60-second windows would smooth bursts but defeat the point of the cap. Memory cost: ~1000 timestamps in flight per active API key.

**Skip the limiter in dev mode.** The handler already bypasses auth in dev so GraphiQL can introspect; the rate limiter follows the same gate. "Catch your infinite loop locally" isn't the limiter's job.

**Key by API key id, not key prefix or hash.** `validateApiKey` is extended to return `{ valid: true, apiKeyId, keyPrefix }` on success — `apiKeyId` is the rate-limit bucket, `keyPrefix` is unused today but free here and useful for future logging / `X-RateLimit-*` headers (#123).

## Files Changed

### `apps/cms/server/utils/validateApiKey.ts`

Return type extended:

```ts
type ValidateApiKeyResult =
  | { valid: true; apiKeyId: string; keyPrefix: string }
  | { valid: false; message: string };
```

The function already loads the `apiKey` row to check `revokedAt`; surfacing `id` and `keyPrefix` is a one-line return change. One existing caller (`graphql.ts`).

### `apps/cms/server/utils/rateLimitEndpoint.ts`

Add two constants and one helper alongside the existing mutation limiter:

```ts
const GRAPHQL_MAX = 1000;
const GRAPHQL_WINDOW_MS = 1_000;

export function enforceGraphqlRateLimit(event: H3Event, apiKeyId: string) {
  const { allowed, retryAfterMs } = rateLimit(
    `gql:${apiKeyId}`,
    GRAPHQL_MAX,
    GRAPHQL_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}
```

Same shape as `enforceMutationRateLimit`. The 429 body stays minimal — #124 will enrich both endpoints' responses in one pass.

### `apps/cms/server/api/graphql/graphql.ts`

Wire the helper after a successful auth, dev branch unchanged:

```ts
export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  if (process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  enforceGraphqlRateLimit(event, result.apiKeyId);

  return yoga(req, res);
});
```

## Request Flow

```
POST /api/graphql
  ↓
graphql handler
  ↓
NODE_ENV === 'production'? ──→ no ──→ yoga(req, res)   [dev bypass]
  ↓ yes
validateApiKey(event)
  ↓ valid? no ──→ 401 { error }
  ↓ yes (returns { apiKeyId, keyPrefix })
enforceGraphqlRateLimit(event, apiKeyId)
  ↓ allowed? no ──→ 429 + Retry-After header
  ↓ yes
yoga(req, res)
```

## Error Handling

- **429 response shape**: `statusCode: 429`, `statusMessage: 'Too many requests'`, `Retry-After` header set to the seconds until the oldest tracked timestamp ages out (`Math.ceil(retryAfterMs / 1000)`). Body stays minimal — #124 will enrich.
- **Counts every request that passes auth**, including ones that fail GraphQL parse / validation / execution. That's standard rate-limit semantics — limit attempts, not successes — and matches the existing mutation limiter.
- **Failed auth doesn't count.** The rate-limit increment happens after `validateApiKey` returns valid, so 401 floods don't pollute legitimate keys' buckets. (A separate per-IP limit on auth failures could be a future hardening, but isn't this ticket's job.)

## Testing

### Unit test — `apps/cms/server/utils/rateLimitEndpoint.test.ts` (new file)

Resets the rate-limit store between tests via `resetRateLimitStore()`.

- Calling `enforceGraphqlRateLimit(mockEvent, 'test-key')` 1000 times in a row — all allowed, no throw.
- 1001st call throws a 429 `H3Error` and sets the `Retry-After` header on the mock event.
- Different `apiKeyId` values are independent buckets — `'a'` exhausting its limit doesn't affect `'b'`.
- After the 1-second window expires (advance time via `vi.useFakeTimers()` + `vi.advanceTimersByTime`), the same key is allowed again.

### Validator test — `apps/cms/server/utils/validateApiKey.test.ts` (new file or extend)

Confirm the new return shape:

- Valid key returns `{ valid: true, apiKeyId, keyPrefix }` with the correct id/prefix from the seeded test key.
- Revoked key still returns `{ valid: false, message }` (unchanged).
- Missing/invalid header still returns `{ valid: false, message }` (unchanged).

### Integration test — `apps/cms/server/api/graphql/graphql.test.ts`

A single happy-path request still succeeds with the test API key — proves the helper is wired and not blocking. **No 1001-request burst test.** A real-HTTP burst at the production threshold would take several seconds in CI and the unit test already exercises the limit logic deterministically. Skip the integration burst.

## Out of Scope

Explicitly deferred to keep this PR focused:

- **`X-RateLimit-*` response headers** → #123. Will read the same rate-limit store; no refactor of this work needed.
- **Richer 429 body** (`retryAfter`, `suggestion`) → #124. Will touch both `enforceMutationRateLimit` and `enforceGraphqlRateLimit` together.
- **Per-operation query-cost scoring** → #122. Independent — works alongside RPS limiting, not instead of it.
- **Configurable threshold via env var.** Not needed yet — the 1000 RPS cap is operator-friendly out of the box, and a `GRAPHQL_RATE_LIMIT_MAX` knob can be added in one line if/when an operator asks. YAGNI for now.
- **Per-IP fallback when no API key** (e.g. anonymous dev mode). Dev bypasses auth; production requires a key. There is no third path.

## Migration / Compatibility

No data migrations. No public API contract changes for happy-path callers. New 429 response on overloaded keys is a behaviour change but a documented one — the load-test report's consumer guidance already prescribes "On 429: honour `Retry-After`."
