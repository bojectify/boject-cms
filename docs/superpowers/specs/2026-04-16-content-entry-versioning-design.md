# Content Entry Versioning — Design Spec

**Issue:** [#50](https://github.com/ness-EE/boject-cms/issues/50)
**Date:** 2026-04-16

## Problem

A `ContentEntry` is a single database row holding both content data and publishing status. There is no way to save draft edits to a published entry without overwriting what external consumers (GraphQL, REST API) see. The save action and status change are coupled — the user manually picks a status from a dropdown and hits one save button.

## Solution

Introduce a `ContentEntryVersion` table implementing a two-slot versioning model. Each `ContentEntry` has at most two active versions: one PUBLISHED and one draft (DRAFT or CHANGED). The CMS UI works on drafts while external APIs serve the published version.

## Data Model

### ContentEntry (envelope)

Keeps: `id`, `contentTypeId`, `slug`, `entryTitle`, `createdAt`, `updatedAt`, relation to `ContentType`, relation to `ContentEntryVersion[]`.

Drops: `data`, `status`, `publishedAt`, `createdBy`, `updatedBy` (all move to the version).

`slug` and `entryTitle` remain on the envelope because:

- Uniqueness constraints (`@@unique([contentTypeId, slug])`, `@@unique([contentTypeId, entryTitle])`) apply at the content-type level regardless of version status.
- Updated eagerly on every save (draft or publish) so conflicts are caught immediately.

### ContentEntryVersion (new)

| Field       | Type          | Notes                               |
| ----------- | ------------- | ----------------------------------- |
| id          | UUID          | Primary key                         |
| entryId     | FK            | → ContentEntry, cascade delete      |
| data        | Json (JSONB)  | The content field values            |
| entryTitle  | String        | Denormalized copy for serving       |
| status      | ContentStatus | DRAFT, PUBLISHED, CHANGED, ARCHIVED |
| publishedAt | DateTime?     | Set when version is published       |
| createdBy   | String?       | Session user email                  |
| updatedBy   | String?       | Session user email                  |
| createdAt   | DateTime      | Auto                                |
| updatedAt   | DateTime      | Auto                                |

**Constraint:** A partial unique index enforces the two-slot invariant:

```sql
CREATE UNIQUE INDEX ON "ContentEntryVersion" ("entryId", "status")
WHERE "status" IN ('DRAFT', 'PUBLISHED', 'CHANGED');
```

At most one DRAFT/CHANGED and one PUBLISHED per entry. Multiple ARCHIVED rows are allowed for future rollback.

### Relation references

RELATION and MULTIRELATION fields store `{ contentTypeId, entryId }` in the JSONB data. The `entryId` points to the ContentEntry envelope, not a specific version. Relations are stable across publishes.

## Status Flow

```
New entry:
  Save Draft → creates DRAFT version
  Publish    → creates PUBLISHED version (in-place, no draft left)

Published entry (no draft):
  User edits a field → dirty detection, Save Draft button enables
  Save Draft → creates CHANGED version (PUBLISHED stays intact)

Published entry with CHANGED version:
  Save Changes → updates existing CHANGED version
  Publish Changes → promotes CHANGED to PUBLISHED, deletes old PUBLISHED
  Discard Changes → deletes CHANGED version, editor reverts to PUBLISHED
```

## Decisions

| Question                                              | Answer                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| What does the entry listing show?                     | Draft version's title/status, with badge indicating state              |
| What happens when publishing a brand-new entry?       | The DRAFT version is promoted to PUBLISHED in-place (same row)         |
| What happens to the old PUBLISHED version on publish? | Hard deleted — no version history in this scope                        |
| When is entryTitle uniqueness enforced?               | Immediately on draft save (not deferred to publish time)               |
| Can new entries be published directly?                | Yes — both Publish and Save Draft available from the start             |
| Can users discard a draft?                            | Yes — deletes the CHANGED version, reverts editor to published content |

## API Behaviour

### Consumer distinction

The auth middleware sets `event.context.authMethod = 'session' | 'apikey'` after successful authentication. A new `resolveVersion` server utility uses this to determine which version to serve.

### Endpoint behaviour

| Endpoint                              | CMS (session)                                       | External (API key)                  |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| GET /api/content-entries/:id          | Draft version (CHANGED > DRAFT), fallback PUBLISHED | PUBLISHED only, 404 if none         |
| GET /api/content-entries              | All entries, draft version's status                 | Only entries with PUBLISHED version |
| GET /api/content                      | All entries, draft version's status                 | Only entries with PUBLISHED version |
| POST /api/content-entries             | Creates envelope + DRAFT or PUBLISHED version       | N/A (read-only)                     |
| PUT /api/content-entries/:id          | Save draft or publish (see below)                   | N/A (read-only)                     |
| DELETE /api/content-entries/:id       | Deletes envelope + all versions (cascade)           | N/A (read-only)                     |
| DELETE /api/content-entries/:id/draft | Deletes CHANGED/DRAFT version, returns published    | N/A (read-only)                     |
| GraphQL                               | N/A (has own API key gate)                          | PUBLISHED versions only             |

### PUT endpoint actions

Inferred from `body.status`:

- `status === 'PUBLISHED'` → **Publish:** promote draft to PUBLISHED, delete old PUBLISHED (transaction: delete first, update second to respect unique index)
- No status, or DRAFT/CHANGED → **Save draft:** upsert DRAFT or CHANGED version. Server auto-determines status: CHANGED if a published version exists, DRAFT otherwise.
- `status === 'ARCHIVED'` → **Archive:** set version status to ARCHIVED

### New endpoint: DELETE /api/content-entries/:id/draft

- Deletes the CHANGED or DRAFT version for a given entry
- Returns the published version (flattened) so the editor can reload
- 404 if no draft version exists
- Used by the "Discard Changes" action in the UI

### Response shape

All endpoints flatten the envelope + version into the legacy response shape for backward compatibility:

```json
{
  "id": "entry-uuid",
  "contentTypeId": "...",
  "data": { ... },
  "entryTitle": "...",
  "slug": "...",
  "status": "DRAFT",
  "publishedAt": null,
  "createdBy": "...",
  "updatedBy": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "hasPublishedVersion": false
}
```

The `hasPublishedVersion` field is included only for CMS (session) requests.

## GraphQL

The GraphQL API (external consumers, API key auth) always serves PUBLISHED versions only.

- Per-type queries (`blogPostList`, `blogPost`, `blogPostBySlug`) include `versions: { where: { status: 'PUBLISHED' } }` and flatten envelope + version.
- RELATION/MULTIRELATION field resolution includes `versions` with a PUBLISHED filter.
- Raw SQL in `jsonbFilters.ts` (`queryDynamicEntries`) JOINs `ContentEntryVersion` with `v."status" = 'PUBLISHED'` and references `v."data"` for JSONB field access.
- The cross-type `contentEntryList` query gets the same JOIN treatment.

## CMS UI

### Sidebar states

Four sidebar states, driven by version status and dirty detection:

1. **New Entry (Draft)** — Publish and Save Draft both active. Blue "Draft" badge.
2. **Published Entry** — Both buttons disabled (nothing to do). Green "Published" badge with timestamp.
3. **Published · Unsaved Edits** — Client-side only (dirty detection, no database status). Transitional state when user edits a published entry. Publish disabled. Save Draft enables with blue accent. Status still shows "Published".
4. **Unpublished Changes (Changed)** — "Publish Changes" and "Save Changes" both active. Yellow "Changed" badge. Published timestamp shown. Red "Discard Changes" link at bottom.

Flow: 2 → (user types) → 3 → (Save Draft) → 4 → (Publish Changes) → 2.

### ContentEditor changes

- Single Save button replaced with state-dependent action buttons (Save Draft / Save Changes / Publish / Publish Changes)
- Status dropdown removed — status is controlled by button actions
- Status badge shows current version status (read-only)
- Component receives: `onSaveDraft`, `onPublish`, `onDiscardChanges` callbacks and `status`, `hasPublishedVersion`, `isDirty` props

### Composable changes (useContentEntryEditor)

- Single `save()` replaced with `saveDraft()` and `publish()`
- New `discardChanges()` function (calls DELETE /api/content-entries/:id/draft)
- New reactive state: `hasPublishedVersion`, `isDirty`
- Dirty tracking via JSON snapshot comparison of formState

### Dirty detection

- `beforeunload` browser event: prevents accidental tab close with unsaved changes
- `onBeforeRouteLeave` Vue Router guard: "You have unsaved changes. Leave anyway?" confirmation
- Browser-side only — no server autosave in this scope

### Shared utility extraction

`mapFieldToConfig()` is currently duplicated across `[entryId].vue`, `new.vue`, and `EntryEditorPane.vue`. Extract to `utils/mapFieldToConfig.ts` as a prerequisite cleanup.

## Content Bundle CLI

- Bundle format version bumped to 2
- New `BundleEntryVersion` type with `status`, `data`, `publishedAt`
- `BundleEntry` gains `versions` array
- V1 bundles (flat status/data) still accepted on import (backward compat)
- Export queries with `include: { versions: true }`, exports V2 format
- Import creates envelope + versions via nested Prisma create
- Starter bundles updated to V2 format

## Migration

1. CREATE TABLE `ContentEntryVersion`
2. INSERT INTO `ContentEntryVersion` from existing `ContentEntry` columns
3. ALTER TABLE `ContentEntry` DROP COLUMN data, status, publishedAt, createdBy, updatedBy
4. CREATE partial unique index for active status constraint
5. CREATE index on `entryId` for fast lookups
