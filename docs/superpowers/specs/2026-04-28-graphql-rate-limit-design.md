# GraphQL rate limit (per API key)

## Overview

Apply a per-API-key sliding-window rate limit to `/api/graphql` in production. Default threshold: **1000 requests per second per API key**, derived from the load-test report at `perf/reports/2026-04-28-e869073/summary.md` (the report ran on the maintainer's local machine — Scenario 1B held p99 < 9 ms with 0% errors all the way up to the test ceiling of 2000 RPS, so 1000 leaves >2× headroom on that hardware).

The threshold is operator-tunable via the `GRAPHQL_RATE_LIMIT_RPS` environment variable. Operators are expected to run the same `perf/` sweep against their own infrastructure, identify their hardware's soft breakpoint, and set the env var accordingly. The 1000 default exists so a fresh deployment is sensibly capped out of the box, not so it's the right answer for every host.

This ticket (#121) is the foundation. Two follow-up tickets layer on top without reorganising what we land here:

- **#123** adds `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers (and GraphQL `extensions` payload).
- **#124** enriches the 429 response body with `retryAfter` and consumer-guidance `suggestion` strings.

#122 (per-operation query-cost scoring) is independent of this work.

## Approach

**Reuse `apps/cms/server/utils/rateLimit.ts`** — the existing sliding-window helper with `resetRateLimitStore()` for tests. Same primitive that backs `enforceMutationRateLimit`.

**Add a sibling helper in `rateLimitEndpoint.ts`** rather than refactor the file into a generic core. Two callers (mutations + GraphQL) doesn't justify an abstraction; the parallel structure also keeps the 429 surface easy to migrate when #124 lands.

**Strict 1-second sliding window of N requests** (N defaults to 1000, env-configurable). Matches the literal "RPS" framing from the report and protects against burst behaviour — a client that briefly bursts to N×1.5 RPS gets the excess rejected with `Retry-After ≈ 1s` and recovers cleanly as the window slides forward. Rolling 60-second windows would smooth bursts but defeat the point of the cap. Memory cost: ~N timestamps in flight per active API key.

**Threshold read at runtime, not module init.** `parseInt(process.env.GRAPHQL_RATE_LIMIT_RPS ?? '1000', 10)` runs inside `enforceGraphqlRateLimit` on every call — cost is negligible (single parseInt + comparison vs. a sub-millisecond request budget) and tests can override with `process.env.GRAPHQL_RATE_LIMIT_RPS = '5'` without `vi.resetModules()` gymnastics. Invalid values (`NaN`, `≤ 0`) silently fall back to the 1000 default — operators who fat-finger the var see normal-default behaviour rather than a crashed server.

**Window stays hardcoded at 1 second.** Making the window configurable too is YAGNI — the term "RPS" only makes sense with a 1-second window, and a separate `_WINDOW_MS` knob would invite confusing combinations like "100 requests per 5 minutes."

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

Add a constant, a parser, and one helper alongside the existing mutation limiter:

```ts
const GRAPHQL_DEFAULT_MAX = 1000;
const GRAPHQL_WINDOW_MS = 1_000;

function getGraphqlMax(): number {
  const raw = process.env.GRAPHQL_RATE_LIMIT_RPS;
  if (!raw) return GRAPHQL_DEFAULT_MAX;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return GRAPHQL_DEFAULT_MAX;
  return parsed;
}

export function enforceGraphqlRateLimit(event: H3Event, apiKeyId: string) {
  const { allowed, retryAfterMs } = rateLimit(
    `gql:${apiKeyId}`,
    getGraphqlMax(),
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

### `apps/cms/.env.example`

Document the new env var:

```env
# GraphQL rate limit (per API key, per second). Defaults to 1000 if unset
# or invalid. Run the perf/ sweep against your own infrastructure to pick
# a threshold that matches your hardware's measured headroom.
GRAPHQL_RATE_LIMIT_RPS=1000
```

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

Resets the rate-limit store between tests via `resetRateLimitStore()`. Env-var manipulation uses `vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', ...)` per test with `vi.unstubAllEnvs()` in `afterEach` — keeps tests hermetic regardless of the developer's shell env.

- **Default applies when env var unset.** `vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '')` (or unstub); first 1000 calls allowed, 1001st throws 429.
- **Env var honoured.** With `GRAPHQL_RATE_LIMIT_RPS=5`, first 5 calls allowed, 6th throws 429 with `Retry-After` set on the mock event.
- **Invalid env values fall back to default.** `GRAPHQL_RATE_LIMIT_RPS='abc'`, `'-1'`, `'0'`, `'NaN'` each behave like an unset var (1000 cap).
- **Independent buckets per `apiKeyId`.** With cap 5, exhausting `'a'` doesn't affect `'b'`.
- **Window expiry.** With cap 5, exhaust the limit, advance fake timers past 1 second, the same key is allowed again.

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
- **Configurable window size.** Window stays 1s; "RPS" only makes sense at that granularity. Re-evaluate if a future use case needs a different shape.
- **Per-IP fallback when no API key** (e.g. anonymous dev mode). Dev bypasses auth; production requires a key. There is no third path.
- **Boot-time validation / warning logs for invalid `GRAPHQL_RATE_LIMIT_RPS`.** Silent fallback is good enough for v1; #123 (rate-limit headers) will surface the effective cap to operators via `X-RateLimit-Limit`, which is a more actionable observability surface than a startup log line.

## Migration / Compatibility

No data migrations. No public API contract changes for happy-path callers. New 429 response on overloaded keys is a behaviour change but a documented one — the load-test report's consumer guidance already prescribes "On 429: honour `Retry-After`."
