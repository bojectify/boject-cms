# Entry Lifecycle: Unpublish, Archive, Unarchive, Republish

## Overview

Extend the content-entry state machine with four new editor actions — **Unpublish**, **Archive**, **Unarchive**, **Republish** — and wire them into the webhooks delivery path. Closes GitHub issue #102, unblocks `ENTRY_UNPUBLISHED` from the webhooks spec (`docs/superpowers/specs/2026-04-20-webhooks-design.md`), and bundles with the webhooks implementation because the two share one delivery seam.

Today editors can only Save Draft, Publish, Discard Changes, or Delete. There is no way to demote a live entry, no audit-friendly "retired" state, and no way to re-fire a webhook for a still-live entry whose consumer missed the last delivery.

## Goals

- Add four discrete endpoints (`/unpublish`, `/archive`, `/unarchive`, `/republish`) that mutate the existing `ContentEntryVersion` rows transactionally.
- Fire the correct webhook events from those transitions — `ENTRY_UNPUBLISHED` on unpublish + archive-from-PUBLISHED, `ENTRY_PUBLISHED` on republish, nothing on unarchive.
- Surface the actions in the entry editor as an overflow menu, and filter archived entries out of list pages (by default) and the relation picker (always).
- Preserve the two-slot invariant (≤1 draft + ≤1 published per entry) under every new transition.

## Non-Goals

- Cascade semantics when a referenced entry is deleted. Tracked in #19; scope-expanded there.
- Any schema migration on `ContentEntry` / `ContentEntryVersion`. All new behaviour fits on existing columns.
- A global "Archive" sidebar nav view. Archive lives inside each list page via a filter chip.
- Disambiguating "never-published Draft" from "previously-published Draft" in the UI. Both render as `Draft`.
- Scheduled unpublish, bulk actions, or role-based permission gates. All actions are CMS-session-only and immediate, matching the existing publish/delete endpoints.

## State Machine

The existing three statuses (`DRAFT`, `CHANGED`, `PUBLISHED`) plus `ARCHIVED` form the complete state set. This design does not add or remove enum values — `ARCHIVED` already exists in the schema and was surfaced but never transitioned into by any endpoint.

Transitions (each row is an editor-invokable action):

| Action                     | Allowed from                     | Version mutation                                                                                                                    | Blocked when                                                 | Webhook                                                                                                                  |
| -------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Publish (existing)         | `DRAFT`, `CHANGED`               | Draft row → `PUBLISHED`; old PUBLISHED deleted                                                                                      | —                                                            | `ENTRY_PUBLISHED`                                                                                                        |
| Save Draft (existing)      | `DRAFT`, `CHANGED`, or new entry | Upserts DRAFT / CHANGED row                                                                                                         | —                                                            | none                                                                                                                     |
| Discard Changes (existing) | `CHANGED`                        | Delete CHANGED row                                                                                                                  | —                                                            | none                                                                                                                     |
| **Unpublish**              | `PUBLISHED`                      | If CHANGED exists: delete PUBLISHED row; CHANGED row status flips to `DRAFT`. If no CHANGED: PUBLISHED row status flips to `DRAFT`. | —                                                            | `ENTRY_UNPUBLISHED` (snapshot: the PUBLISHED version being demoted)                                                      |
| **Archive**                | `PUBLISHED`                      | PUBLISHED row status flips to `ARCHIVED`. Envelope unchanged.                                                                       | CHANGED exists — returns 409 `DRAFT_PRESENT`                 | `ENTRY_UNPUBLISHED` (snapshot: the PUBLISHED version being retired)                                                      |
| **Unarchive**              | `ARCHIVED`                       | ARCHIVED row status flips to `DRAFT`.                                                                                               | —                                                            | none (consumers never saw ARCHIVED)                                                                                      |
| **Republish**              | `PUBLISHED`                      | No data change.                                                                                                                     | Entry has no PUBLISHED version — returns 409 `NOT_PUBLISHED` | `ENTRY_PUBLISHED` (snapshot: current PUBLISHED, byte-identical to the last delivery save for `deliveryId` + `timestamp`) |
| Delete (existing)          | any                              | Row + envelope gone                                                                                                                 | —                                                            | `ENTRY_DELETED` iff PUBLISHED existed at delete time                                                                     |

Key derived facts:

- **`ARCHIVED` count per entry is ≤ 1** in practice, because archive mutates the row's status rather than creating a snapshot. The schema allows unlimited ARCHIVED rows (no partial unique index on ARCHIVED) — this is fine; we simply don't create more than one.
- **The two-slot invariant** (partial unique index on `(entryId, status)` for non-archived statuses) is preserved under every transition. Each transition modifies exactly one row and never yields two DRAFT / CHANGED / PUBLISHED rows simultaneously.
- **Unpublish with CHANGED** takes the editor's in-progress work as the new DRAFT. The PUBLISHED snapshot is lost (it's delivered as the `ENTRY_UNPUBLISHED` webhook payload; consumers who want the history keep their own record).
- **Archive reserves the entry's title and slug** because `@@unique([contentTypeId, entryTitle])` and `@@unique([contentTypeId, slug])` are on the envelope, not the version, and archive doesn't touch the envelope. If an editor needs to reuse the title, they either rename the archive first or delete it outright.

## Endpoints

Four new endpoints, each a thin wrapper around a transactional state change. All require a CMS session (API-key callers get 403), go through the existing CSRF middleware, and call `enforceMutationRateLimit`.

```
POST /api/content-entries/[id]/unpublish   → 200, flattened entry (new DRAFT)
POST /api/content-entries/[id]/archive     → 200, flattened entry (new ARCHIVED)
                                             409 { error: 'DRAFT_PRESENT' } if CHANGED exists
POST /api/content-entries/[id]/unarchive   → 200, flattened entry (new DRAFT)
POST /api/content-entries/[id]/republish   → 200, flattened entry (unchanged PUBLISHED)
                                             409 { error: 'NOT_PUBLISHED' } if no PUBLISHED version
```

Discrete endpoints rather than overloaded `PUT` so each action owns its own rate-limit key, audit line, and transaction. The existing `PUT /api/content-entries/[id]` keeps its publish-on-`status='PUBLISHED'` branch unchanged.

**Each handler's shape:**

1. Load the entry with all versions + content type.
2. Delegate to a pure state-machine helper (see below) that validates the transition and returns either a mutation plan or a structured error.
3. On error: throw `createError({ statusCode: 409, statusMessage, data: { error } })`.
4. On success: run the mutation plan inside `prisma.$transaction(async (tx) => …)`, call `enqueueWebhookDeliveries(tx, …)` for actions that emit events, and return the flattened entry via the existing `flattenEntryWithVersion` helper.

**State-machine helper** (`apps/cms/server/utils/entryTransitions.ts`):

```ts
type TransitionAction = 'unpublish' | 'archive' | 'unarchive' | 'republish';

type TransitionPlan =
  | {
      kind: 'ok';
      mutations: VersionMutation[];
      webhookEvent: WebhookEvent | null;
      snapshot: WebhookEntrySnapshot | null;
    }
  | {
      kind: 'error';
      error: 'DRAFT_PRESENT' | 'NOT_PUBLISHED' | 'WRONG_STATE';
      message: string;
    };

export function planTransition(
  entry: ContentEntryWithVersions,
  action: TransitionAction
): TransitionPlan;
```

Pure, fully unit-tested over a fake version array. The handlers are thin glue: they load, call `planTransition`, execute the plan in a transaction, and serialise the response. This keeps the branch matrix testable without a DB and keeps each handler under ~40 lines.

## Webhook Integration

All wiring goes through the existing `enqueueWebhookDeliveries(tx, { event, contentType, entry })` helper introduced in the webhooks plan. No changes to that helper's signature.

| Endpoint          | Event               | Payload entry snapshot                                                                         |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /unpublish` | `ENTRY_UNPUBLISHED` | the PUBLISHED version being demoted (data, publishedAt, title, slug at the moment of demotion) |
| `POST /archive`   | `ENTRY_UNPUBLISHED` | the PUBLISHED version being retired (same shape)                                               |
| `POST /unarchive` | none                | —                                                                                              |
| `POST /republish` | `ENTRY_PUBLISHED`   | the current PUBLISHED version, verbatim                                                        |

Payload shape is the one defined in the webhooks spec — identical across events, with `event` distinguishing them. All snapshots are captured **before** the mutation runs, so `ENTRY_UNPUBLISHED` delivers the consumer's last-known live state.

The `ENTRY_UNPUBLISHED` option in the webhook create/edit UI drops its "Reserved — does not fire" badge and becomes a live checkbox the instant this work lands.

## UI

### Entry editor sidebar (`EntrySidebar.vue`)

The existing Publish / Save Draft / Discard Changes action stack stays. A new kebab "More actions" overflow menu sits adjacent, containing:

Visibility predicates are expressed in terms of whether the entry **has** a version in a given status, not the CMS-resolved "current" status (which prefers `CHANGED > DRAFT > PUBLISHED` and would otherwise hide Unpublish/Archive behind a pending draft):

| Menu item | Visible when                    | Icon                             | Confirmation                                                                                                      |
| --------- | ------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Unpublish | entry has a `PUBLISHED` version | `i-lucide-eye-off`               | inline (two-step click)                                                                                           |
| Republish | entry has a `PUBLISHED` version | `i-lucide-refresh-cw`            | none — idempotent                                                                                                 |
| Archive   | entry has a `PUBLISHED` version | `i-lucide-archive`               | modal — "Archive this entry?"; server returns 409 `DRAFT_PRESENT` if CHANGED exists, surfaced inline in the modal |
| Unarchive | entry has an `ARCHIVED` version | `i-lucide-archive-restore`       | none — reversible                                                                                                 |
| Delete    | always                          | `i-lucide-trash-2` (destructive) | modal (unchanged)                                                                                                 |

Items that are illegal for the current state are hidden, not disabled — the available verbs signal state. The `DRAFT_PRESENT` guard for Archive is enforced server-side and surfaced inline in the confirmation modal rather than hiding the button, so the editor learns _why_ the action is blocked. Status badges remain `Draft | Changed | Published | Archived`; previously-published drafts are not distinguished from never-published drafts at the badge level. The Information panel's `publishedAt` row either shows the original publish timestamp (if the row preserves it) or "Never" (if it was cleared on demote); both are acceptable.

### List pages (per-type and All Content)

A filter chip row above the table:

```
Active (default) | Archived | All
```

Changes a `?archiveFilter=active|archived|all` query param and refetches. `Active` excludes entries whose latest version is `ARCHIVED`; `Archived` shows only those; `All` is the superset. The existing `status` and `contentType` filters still compose within the chosen archive bucket.

### Entry picker modal (`EntryPickerModal.vue`)

Archived entries are always excluded, server-side, from the picker's list response. No UI change — they silently don't appear. An editor who wants to reference an archived entry must unarchive it first.

### Webhook create/edit UI

The `ENTRY_UNPUBLISHED` event option in the webhook form's event checklist drops its "Reserved" badge once this work lands, and the "Does not fire" help text is removed. No other change to the webhooks UI.

## Testing

### Unit

`server/utils/entryTransitions.test.ts` covers `planTransition` against fake version arrays. One test per row of the Section 1 transition table, plus:

- Unpublish from `PUBLISHED` with no CHANGED.
- Unpublish from `PUBLISHED` with CHANGED — assert CHANGED's data survives as the resulting DRAFT.
- Archive blocked when CHANGED present — assert `{ kind: 'error', error: 'DRAFT_PRESENT' }`.
- Republish blocked when no PUBLISHED — assert `{ kind: 'error', error: 'NOT_PUBLISHED' }`.
- Unarchive emits no webhook.

### Integration

Append to `apps/cms/server/api/content-entries/content-entries.test.ts`. For each endpoint:

- Happy path — assert final version state on the DB + correct `WebhookDelivery` row enqueued (or absent for unarchive).
- Wrong-state rejection — e.g. `POST /unpublish` on a draft-only entry returns 409 `WRONG_STATE`.
- Archive with CHANGED → 409 `DRAFT_PRESENT`, nothing enqueued.
- Republish snapshot fidelity — two consecutive republishes produce deliveries whose `payload.entry.data` objects are deep-equal (only `deliveryId` and `timestamp` differ).
- API-key callers get 403 on all four endpoints.

Cross-cutting test:

- **Archived invisibility** — create + publish + archive an entry, then assert:
  - `/api/content-entries?contentTypeId=X` default response omits it.
  - Same query with `archiveFilter=archived` includes it.
  - The entry picker server response omits it unconditionally.

### E2E

Extend the webhooks e2e file (`apps/cms/server/api/webhooks/webhook-e2e.test.ts`):

- Unpublish → stub HTTP server receives `ENTRY_UNPUBLISHED` with the prior PUBLISHED-version snapshot.
- Archive a PUBLISHED entry → stub receives the same event + shape.
- Republish an unchanged PUBLISHED entry → stub receives `ENTRY_PUBLISHED` with a payload matching the current live entry.

### Manual smoke

Documented as steps in the combined plan's verification task:

- Overflow menu shows correct items per state across Draft / Changed / Published / Archived.
- Archive modal fires and blocks with the 409 error when CHANGED exists.
- Unpublish inline confirm works.
- Republish fires with no confirmation.
- Filter chip on list page hides/shows archived as expected; default is hidden.
- Entry picker does not offer archived entries.

No Storybook interaction tests in this tranche. Overflow menu testing is a separate shoring-up pass once we have a pattern.

## Integration With the Webhooks Implementation Plan

The webhooks spec and this spec share a single implementation plan (rather than two sequential plans). Both tickets (#52 and #102) are rc.1 show-stoppers and touch the same `enqueueWebhookDeliveries` seam; splitting creates rework.

Changes to the webhooks plan as originally drafted:

- **Task 7** (wire `ENTRY_PUBLISHED`): extended. Republish endpoint also calls `enqueueWebhookDeliveries` inside its own transaction.
- **Task 8** (wire `ENTRY_DELETED`): unchanged.
- **New tasks** inserted between Task 8 and Task 9 (before the worker lands), in this order:
  1. `planTransition` helper + unit tests.
  2. `POST /unpublish` + integration tests.
  3. `POST /archive` + integration tests (including `DRAFT_PRESENT` blocker).
  4. `POST /unarchive` + integration tests.
  5. `POST /republish` + integration tests.
- **UI tasks** appended to the existing Task 18–22 block:
  - `EntrySidebar` overflow menu with action wiring.
  - List-page archive filter chip (reused across All Content + per-type pages).
  - `EntryPickerModal` server-side archived filter.
  - `Archived` status badge styling.
- **Webhook create/edit UI task** (from the webhooks plan) drops the "Reserved" badge on `ENTRY_UNPUBLISHED`.
- **CLAUDE.md doc task** merged into a single update covering state machine + webhooks.

Approximate total task count for the bundled plan: ~28 (up from 24 in the webhooks-only plan).

## Security

- All four endpoints are session-only. `isCmsRequest(event)` check as the first line. API-key callers get 403.
- CSRF middleware already covers non-`/api/auth` mutations; no opt-out.
- Rate limiting reuses `enforceMutationRateLimit`, one key per endpoint (`content-entries.unpublish`, `.archive`, `.unarchive`, `.republish`) so a flood on one action doesn't exhaust the budget for another.
- Archived entries remain invisible to API-key consumers (the existing `status = 'PUBLISHED'` filter on all read paths already enforces this; no new filter needed).

## Migration Notes

- No Prisma schema change.
- No data migration.
- Existing rows don't need backfilling — nothing depends on `wasPublished`-style flags.
- The webhooks migration from the existing spec (adds `Webhook` + `WebhookDelivery`) is the only DB change in the combined plan.

## Out of Scope

- **#19** — cascade behaviour on delete of a referenced entry. Needs re-scoping from "nice to have" to rc.1 priority, since archive reduces the friction of deletes (editors will delete less) but doesn't eliminate the dangling-reference hazard on the deletes that do happen. Target behaviour for #19 (agreed in brainstorming):
  - Required relation target deleted → cascade-unpublish the parent to DRAFT, fire `ENTRY_UNPUBLISHED`.
  - Optional relation target deleted → null-out the reference in a new CHANGED version on the parent; PUBLISHED stays intact with the dangling ref until the editor republishes.
- Scheduled (time-delayed) unpublish or publish.
- Bulk state transitions across multiple entries.
- Role-based authorisation gates on state transitions (tracked via the general RBAC ticket).
- A dedicated Archive view in the sidebar.
- Storybook interaction tests for the overflow menu.
