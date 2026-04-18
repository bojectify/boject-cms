# User-configurable unique fields

Closes #47 (with follow-up scope).

## Problem

Today, only `ENTRY_TITLE` and `SLUG` fields carry a uniqueness guarantee, enforced at the database level via `@@unique([contentTypeId, entryTitle])` and `@@unique([contentTypeId, slug])` on `ContentEntry`. Users cannot mark other fields as unique — even though real-world schemas routinely require uniqueness on things like SKU, ISBN, email, or issue number.

The first pass at issue #47 shipped a cosmetic `Unique` badge by hardcoding a `type === 'ENTRY_TITLE' || type === 'SLUG'` check in the view (PR #71). That's brittle and doesn't serve the actual user need, which is to be able to _declare_ uniqueness on the fields they create.

## Goals

- Let users toggle a `Unique` flag on `TEXT` and `NUMBER` fields via the content-type editor.
- Enforce uniqueness at entry save time across all versions of a content type.
- Drive the existing `Unique` badge from a real data flag rather than a type check.
- Keep ENTRY_TITLE / SLUG uniqueness working exactly as it does today.

## Non-goals

- Case-insensitive uniqueness (future option on TEXT).
- Uniqueness on `DATETIME`, `SELECT`, `BOOLEAN`, `RELATION`, `MULTIRELATION`, `RICHTEXT`, `IMAGE` (deferred; complexity not justified by demand yet).
- Race-safe uniqueness via DB-level constraints on JSONB (deferred — tracked as a follow-up issue).
- Cross-content-type uniqueness.

## Design

### Data model

Add `unique Boolean @default(false)` to `ContentTypeField`. Migration:

```sql
ALTER TABLE "ContentTypeField" ADD COLUMN "unique" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ContentTypeField" SET "unique" = true WHERE "type" IN ('ENTRY_TITLE', 'SLUG');
```

Invariants (enforced in the field CRUD endpoints, not at the schema level):

- `unique` must be `true` for `ENTRY_TITLE` and `SLUG` fields, and is not editable after creation for those types.
- `unique` is only user-writable on `TEXT` and `NUMBER` fields.
- Any request setting `unique: true` on another type returns 400.

### Enforcement

A new helper `assertUniqueFieldValues(data, fields, contentTypeId, excludeEntryId?)` runs from the entry POST/PUT handlers, after `validateEntryData` returns. It targets only fields where `unique === true && (type === 'TEXT' || type === 'NUMBER')` — the existing DB constraints continue to cover ENTRY_TITLE/SLUG.

For each candidate field:

1. Skip if the incoming value is `null`, `undefined`, or `''`.
2. Query `ContentEntryVersion` joined on its `ContentEntry` envelope filtered by `contentTypeId`, looking for any version whose `data->>'<identifier>'` equals the incoming value. For `TEXT`, compare as text; for `NUMBER`, cast both sides to numeric. Exclude `excludeEntryId` on updates.
3. If any match exists, throw a 409 with body `{ error: 'UNIQUE_CONFLICT', field: '<identifier>', message: '<name> must be unique', value: '<offending value>' }`.

The check spans _all_ versions (DRAFT, CHANGED, PUBLISHED) of every entry in the content type, so promoting a draft can't sidestep uniqueness. Comparison is case-sensitive.

Race condition: two concurrent entry creates can both pass the check and both insert. Accepted tradeoff. A follow-up issue will track upgrading to a PostgreSQL expression unique index for atomic DB-level enforcement.

### Field CRUD endpoints

`POST /api/content-types` and `POST /api/content-types/[id]/fields` (create paths):

- Accept `unique?: boolean` on each field.
- Reject with 400 if `unique: true` is set on a type other than `TEXT`, `NUMBER`, `ENTRY_TITLE`, `SLUG`.
- Auto-force `unique: true` for `ENTRY_TITLE` and `SLUG` regardless of the request body.
- Default `unique: false` on `TEXT`/`NUMBER` if omitted.

`PUT /api/content-types/[id]/fields/[fieldId]`:

- Accept `unique?: boolean`.
- Reject with 400 if the field is `ENTRY_TITLE`/`SLUG` and the request sets `unique: false`.
- Reject with 400 if toggling `unique: true` on a non-`TEXT`/`NUMBER` field.
- When flipping `false → true` on a `TEXT`/`NUMBER` field, run a conflict check: group every entry (by any version) by its current value for the field, find groups of size > 1, and if any exist, respond 409 with:

  ```json
  {
    "error": "UNIQUE_CONFLICT",
    "message": "Cannot mark field as unique — existing entries have duplicate values",
    "conflicts": [
      { "value": "foo", "entryIds": ["id1", "id2"] },
      { "value": "bar", "entryIds": ["id3", "id4", "id5"] }
    ]
  }
  ```

- Toggling `true → false` is always safe — no validation required.

`DELETE /api/content-types/[id]/fields/[fieldId]`: no change.

### UI

**`components/FieldModal.vue`:**

- Add a `Unique` switch beside the existing `Required` switch, only visible when `type === 'TEXT'` or `type === 'NUMBER'`.
- In edit mode for `ENTRY_TITLE`/`SLUG`, render the switch as always-on and disabled.
- Help text under the switch: _"Entries must have distinct values for this field. Empty values are allowed."_
- When a `false → true` save returns 409 `UNIQUE_CONFLICT`, surface a `UAlert` at the top of the modal with the message and a bulleted list of `value → entryIds`, each entry ID linking to `/entries/<id>` in a new tab.

**`pages/content-types/[id]/index.vue` field list:**

- Replace the hardcoded `type === 'ENTRY_TITLE' || type === 'SLUG'` check (PR #71) with `<UBadge v-if="field.unique">Unique</UBadge>`.

**`components/content-editor/ContentEditor.vue` entry editor:**

- When an entry save returns 409 with `{ error: 'UNIQUE_CONFLICT', field, message }`, display the message inline against the offending field (via the existing `UFormField` error slot) and surface a toast.

### Testing

**Unit (new):** `server/utils/validateEntryData.test.ts` covering `assertUniqueFieldValues`:

- skips null/undefined/empty
- detects duplicate TEXT and NUMBER values
- excludes the current entry on update
- case-sensitive comparison
- ignores fields not marked unique or of other types

**Integration (extend existing):**

`server/api/content-types/content-types.test.ts`:

- create field with `unique: true` on TEXT/NUMBER → 201
- create field with `unique: true` on BOOLEAN/RICHTEXT/etc → 400
- ENTRY_TITLE/SLUG auto-set `unique: true` regardless of input
- PUT field to toggle unique on with no duplicates → 200
- PUT field to toggle unique on with duplicates → 409 with conflict details
- PUT field to toggle ENTRY_TITLE/SLUG `unique: false` → 400

`server/api/content-entries/content-entries.test.ts`:

- POST entry with duplicate unique TEXT value → 409
- POST entry with duplicate unique NUMBER value → 409
- POST entry with null/empty unique value alongside another null/empty → both succeed
- PUT entry keeping its own unique value → 200
- Draft version with duplicate value also blocks (cross-version check)

No changes to GraphQL or content-bundle tests — uniqueness enforcement sits inside the entry REST API layer.

## Follow-up

- GH issue: upgrade uniqueness enforcement to a PostgreSQL expression unique index for atomic, race-free guarantees. Approach sketch: when a field is toggled `unique: true`, app code issues `CREATE UNIQUE INDEX idx_unique_<fieldId> ON "ContentEntryVersion" ((data->>'<identifier>')) WHERE "entryId" IN (SELECT id FROM "ContentEntry" WHERE "contentTypeId" = '<id>')`; drop when toggled off; also handle identifier renames.
