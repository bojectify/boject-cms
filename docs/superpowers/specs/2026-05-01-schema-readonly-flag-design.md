# Schema Read-Only Flag

## Overview

Introduce a single environment variable, `BOJECT_SCHEMA_READONLY`, that disables all human-driven content-type and field mutations on a deployed CMS instance. The flag is the precondition for every other piece of the schema-as-code work that follows: it makes "production schema is git-driven" enforceable rather than conventional. It is independently useful — even without schema-as-code, operators may want to lock the schema on a shared instance regardless of whether changes flow from a JSON file.

The flag affects only **schema** mutations (content types, fields). Content **entry** authoring continues normally — editors keep editing on prod. The boundary is the line we want users to internalise.

End-state operator UX:

```
# prod compose
environment:
  BOJECT_SCHEMA_READONLY: "true"

# dev compose (or unset)
# (no flag → fully editable)
```

End-state editor UX on a locked instance:

- The "New Content Type" button is hidden on `/content-types`.
- The field-management section is hidden on `/content-types/[id]`.
- A small banner explains: "Schema is read-only on this environment. Edit in dev and deploy via git."
- API requests to schema-mutating endpoints return `403` with `{ error: 'SCHEMA_READONLY' }`.

## Approach

**Single env var, no per-endpoint granularity.** Either schema mutations are allowed on this instance or they are not. Not worth a permission matrix; the use case is binary.

**Server-side enforcement is the security boundary.** The client-side hides are UX only — anyone with a session cookie could craft a curl call. The 403 in the API is what makes the flag mean something.

**Default: editable.** Unset = `false`. New scaffolds and dev environments work as they do today. Operators opt into lock-down explicitly.

**Reuse the existing helper pattern.** Wraps the same shape as `enforceMutationRateLimit(event, '<id>')` already used by these endpoints — a one-liner at the top of each handler.

**No data-model changes.** No new tables, no migrations. Pure runtime gate.

## Scope

**In:**

- New env var `BOJECT_SCHEMA_READONLY` plumbed through `runtimeConfig.public` so the client can read it. Boolean coercion: `"true"` / `"1"` → true; everything else (including unset) → false.
- New helper `apps/cms/server/utils/schemaReadOnly.ts::assertSchemaEditable(event)` that throws `createError({ statusCode: 403, statusMessage: 'Schema is read-only', data: { error: 'SCHEMA_READONLY' } })` when the flag is on.
- Helper invoked at the top of all 7 schema-mutating endpoints (see "Endpoints Affected" below). Runs after auth, before rate limit and CSRF (which already pass for session-authed mutations).
- Client UI: `useRuntimeConfig().public.schemaReadonly` reactive boolean wired into `/content-types/index.vue`, `/content-types/new.vue`, `/content-types/[id]/index.vue`, and `FieldModal.vue` triggers.
- Banner on `/content-types/index.vue` and `/content-types/[id]/index.vue` when the flag is on.
- Integration tests: every gated endpoint returns 403 with `flag=on`, normal behaviour with `flag=off`. Negative test: `/api/content-entries/*` is unaffected.
- Documentation: env var added to the `Runtime env vars` list in `CLAUDE.md` and to the scaffolder's generated `.env` (commented-out, defaulting to off).

**Out (deferred):**

- Per-user / per-API-key schema permissions. Not the right primitive — the use case is "this _deployment_ doesn't accept schema edits," not "this user can't edit." Revisit only if multi-tenant lands.
- Read-only mode for content entries. Different problem, different lifecycle (e.g. CMS migration windows). Out of scope.
- A way to flip the flag at runtime without a restart. Container env vars are restart-scoped by design. Operators flip it by re-deploying.
- Programmatic source-of-truth check — i.e. a dedicated endpoint the CLI hits to ask "are you a schema-writeable instance?" The CLI's experience of attempting a write and getting 403 is sufficient signal; if the deployment story makes this awkward later, add then.

## Design Decisions

### One flag, not a permission system

The realistic axis is "this environment accepts schema edits or not." Modelling it as a per-user, per-key, or per-resource permission would be premature architecture. If multi-tenancy ever ships, the permission model belongs _there_, not bolted onto a single global. YAGNI.

### Public runtime config, not server-only

The flag must be readable client-side so the UI can hide affordances pre-emptively. Editors confronting buttons that 403 on click is a worse experience than buttons that don't appear. Exposing the flag publicly leaks no information — anyone hitting the deployment can already discover whether schema writes work by trying one. There is no security benefit to hiding it.

### `SCHEMA_READONLY` error code, not bare 403

The CLI (Spec 5) needs to distinguish "the schema endpoint is locked on this instance" from "your API key lacks permission" from "the request was malformed." A discriminated `data.error` mirrors the pattern already used for `UNIQUE_CONFLICT`, `WEAK_PASSWORD`, and `DRAFT_PRESENT`. Future tooling can branch on the code without parsing prose.

### Order of guards in each endpoint

The current order in schema endpoints is: auth (global middleware) → CSRF (global middleware) → rate limit (`enforceMutationRateLimit`) → handler logic. Insert `assertSchemaEditable(event)` as the **first line** of each handler — before rate limit. Reasons:

1. Rejecting locked schema requests before counting them against the rate limit prevents a brief burst of 403s from exhausting the editor's bucket.
2. The check is O(1) — cheaper than the rate limiter's window scan.
3. Conceptually it's a precondition on the resource, not a per-request fairness concern.

### Banner copy is opinionated, not generic

"Schema is read-only on this environment. Edit in dev and deploy via git." is intentionally directive — it points operators toward the workflow we want them to adopt. A generic "this is read-only" banner doesn't teach the convention; this one does. Acceptable tax: when schema-as-code lands (Specs 2–5) the banner copy is already correct.

## Endpoints Affected

All seven schema-mutating endpoints listed in `CLAUDE.md` get the guard:

| Method | Path                                       | Current handler                                                     |
| ------ | ------------------------------------------ | ------------------------------------------------------------------- |
| POST   | `/api/content-types`                       | `apps/cms/server/api/content-types/index.post.ts`                   |
| PUT    | `/api/content-types/[id]`                  | `apps/cms/server/api/content-types/[id].put.ts`                     |
| DELETE | `/api/content-types/[id]`                  | `apps/cms/server/api/content-types/[id].delete.ts`                  |
| POST   | `/api/content-types/[id]/fields`           | `apps/cms/server/api/content-types/[id]/fields/index.post.ts`       |
| PUT    | `/api/content-types/[id]/fields/[fieldId]` | `apps/cms/server/api/content-types/[id]/fields/[fieldId].put.ts`    |
| DELETE | `/api/content-types/[id]/fields/[fieldId]` | `apps/cms/server/api/content-types/[id]/fields/[fieldId].delete.ts` |
| PUT    | `/api/content-types/[id]/fields/reorder`   | `apps/cms/server/api/content-types/[id]/fields/reorder.put.ts`      |

Endpoints **not** affected (explicit list, to make boundaries unambiguous):

- All `/api/content-entries/**` — content authoring continues.
- `/api/files/**` — uploads continue.
- `/api/auth/**`, `/api/account/**` — user lifecycle.
- `/api/webhooks/**` — webhook config is operations, not schema.
- `/api/graphql` — read-only against the schema.
- `/api/content-types` (GET) and `/api/content-types/[id]` (GET) — read endpoints stay open.

## Files Added or Modified

| File                                                                 | Change                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cms/server/utils/schemaReadOnly.ts` (new)                      | `assertSchemaEditable(event)` helper. Reads `useRuntimeConfig().schemaReadonly`. Throws 403 with `{ error: 'SCHEMA_READONLY' }`.                                         |
| `apps/cms/nuxt.config.ts`                                            | Add `runtimeConfig.schemaReadonly` (server-side, defaulting to `process.env.BOJECT_SCHEMA_READONLY`) and `runtimeConfig.public.schemaReadonly` (client-readable mirror). |
| `apps/cms/server/api/content-types/index.post.ts`                    | Insert `assertSchemaEditable(event)` as first line of handler.                                                                                                           |
| `apps/cms/server/api/content-types/[id].put.ts`                      | Same.                                                                                                                                                                    |
| `apps/cms/server/api/content-types/[id].delete.ts`                   | Same.                                                                                                                                                                    |
| `apps/cms/server/api/content-types/[id]/fields/index.post.ts`        | Same.                                                                                                                                                                    |
| `apps/cms/server/api/content-types/[id]/fields/[fieldId].put.ts`     | Same.                                                                                                                                                                    |
| `apps/cms/server/api/content-types/[id]/fields/[fieldId].delete.ts`  | Same.                                                                                                                                                                    |
| `apps/cms/server/api/content-types/[id]/fields/reorder.put.ts`       | Same.                                                                                                                                                                    |
| `apps/cms/composables/useSchemaReadonly.ts` (new)                    | Tiny composable: `() => computed(() => useRuntimeConfig().public.schemaReadonly === true)`. Auto-imported.                                                               |
| `apps/cms/pages/content-types/index.vue`                             | Hide "New Content Type" CTA when readonly. Render banner.                                                                                                                |
| `apps/cms/pages/content-types/new.vue`                               | Redirect to `/content-types` if readonly (defensive — link is hidden but URL is reachable).                                                                              |
| `apps/cms/pages/content-types/[id]/index.vue`                        | Hide field-management section when readonly. Render banner.                                                                                                              |
| `apps/cms/components/field-modal/FieldModal.vue`                     | The modal's open triggers are upstream — covered by the parent page hides. No changes here, but verify by integration test.                                              |
| `apps/cms/server/api/content-types/content-types.test.ts`            | Add a `describe('schema readonly')` block: each gated endpoint returns 403 with `flag=on`, reads still work, content-entry endpoints unaffected.                         |
| `CLAUDE.md`                                                          | Add `BOJECT_SCHEMA_READONLY` to the `Runtime env vars` bullet under "Docker image". Cross-link from a new "Schema editing" subsection of the auth/permissions area.      |
| `packages/create-boject-cms/src/templates/dotEnv.ts` (or equivalent) | Append a commented `# BOJECT_SCHEMA_READONLY=true` line with a short explanation. Default-off matches the existing flag style in `.env`.                                 |

## Test Plan

Co-locate with `apps/cms/server/api/content-types/content-types.test.ts`:

1. **Flag off, mutation succeeds.** Existing tests continue to pass — no behaviour change.
2. **Flag on, every gated endpoint returns 403 with `data.error === 'SCHEMA_READONLY'`.** One assertion per endpoint, one shared `beforeEach` that sets the env var via the test helper.
3. **Flag on, GET requests still succeed.** Verifies the boundary is mutation-only.
4. **Flag on, `/api/content-entries` mutations still succeed.** Verifies the boundary is schema-only.
5. **Order of guards.** Hit a gated endpoint with the flag on and an invalid CSRF origin — expect 403 from CSRF (not 403 from the readonly guard, since CSRF is global middleware and runs first). Documents the ordering.

Browser test in Storybook is unnecessary — the UI hides are static `v-if`s on a runtime config value, the existing component stories don't exercise that wiring, and the cost of stubbing runtime config in Storybook outweighs the value.

## Out of Scope

- API-key permission scopes (deferred to Spec 5 — the CLI design needs them anyway and they're a larger change).
- A "soft" mode that warns but doesn't block. The point of the flag is enforcement; warnings are convention, which we already have.
- Rolling out the flag to existing deployments. Operators set it explicitly; no migration needed.
