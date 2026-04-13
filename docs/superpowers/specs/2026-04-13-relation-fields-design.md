# Relation Fields — RELATION & MULTIRELATION Field Types

## Overview

Add `RELATION` and `MULTIRELATION` to the dynamic content type field system. These are polymorphic relation fields — a single field can reference entries from multiple configured content types. This spec covers schema, validation, field definition UI, and a content type options endpoint. The entry editor UI (picking actual related entries) is a separate spec.

## Scope

**In scope:**

- `RELATION` and `MULTIRELATION` added to `FieldType` enum
- JSONB storage format for relation values
- Server-side validation (field creation, entry data)
- Field definition UI in the `#type-options` slot (chips for target content types)
- `GET /api/content-types/options` endpoint

**Out of scope:**

- Entry editor UI (single picker, multi picker with ordering) — separate spec
- Dangling reference cleanup script — separate project
- GraphQL exposure of relations — separate spec

## Schema

### FieldType Enum

Add two values to the Prisma `FieldType` enum:

```
RELATION
MULTIRELATION
```

### Field Options

The `options` JSON column on `ContentTypeField` stores the allowed target content types:

```json
{
  "targetContentTypeIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

At least one target content type is required. Self-referential relations are allowed (a content type can target itself).

### Entry Data JSONB Format

**RELATION** — a single reference or null:

```json
{ "contentTypeId": "uuid", "entryId": "uuid" }
```

Both fields are UUIDs. `contentTypeId` is needed because the field is polymorphic (the referenced entry could be from any of the allowed target types). Value is `null` when no entry is selected.

**MULTIRELATION** — an ordered array of references:

```json
[
  { "contentTypeId": "uuid-a", "entryId": "uuid-1" },
  { "contentTypeId": "uuid-b", "entryId": "uuid-2" }
]
```

Order is significant (preserved as-is). Empty array `[]` is valid and treated as "none selected".

## Server Validation

### Field Creation (`POST /api/content-types/[id]/fields`)

- Add `RELATION` and `MULTIRELATION` to `VALID_FIELD_TYPES`
- When type is `RELATION` or `MULTIRELATION`, `options.targetContentTypeIds` is required:
  - Must be a non-empty array
  - Each element must be a valid UUID
  - Each UUID must reference an existing content type
- No limit on how many RELATION or MULTIRELATION fields a content type can have

### Field Update (`PUT /api/content-types/[id]/fields/[fieldId]`)

- Add `RELATION` and `MULTIRELATION` to `VALID_FIELD_TYPES`
- Allow updating `options.targetContentTypeIds` (e.g. adding a new allowed target type)
- No retroactive validation of existing entry data when targets change

### Content Type Creation (`POST /api/content-types`)

- Add `RELATION` and `MULTIRELATION` to `VALID_FIELD_TYPES` in the inline creation endpoint
- Same `targetContentTypeIds` validation as field creation

### Entry Validation (`validateEntryData.ts`)

**RELATION:**

- Value must be an object with `contentTypeId` (string, valid UUID) and `entryId` (string, valid UUID)
- `contentTypeId` must be in the field's `options.targetContentTypeIds` list
- `entryId` must exist as a `ContentEntry` with that `contentTypeId`
- Null is valid for non-required fields

**MULTIRELATION:**

- Value must be an array
- Each element validated same as RELATION (object with `contentTypeId` and `entryId`, both valid, entry exists)
- Empty array is valid (treated as "none selected")
- Duplicate `entryId` values within the array are rejected

### Dangling References

When a referenced entry is deleted, the relation value in other entries becomes a dangling reference. This is handled gracefully:

- No cascade cleanup on delete
- The future entry editor UI will show "Deleted entry" or filter out missing references on read
- A separate cleanup script can be built later to scan and remove dangling references

## REST API

### New Endpoint: `GET /api/content-types/options`

Returns all content types as `{ label: string; value: string }[]` for use in the target content type picker. Same pattern as existing options endpoints (`/api/teams/options`, `/api/clubs/options`, etc.).

```typescript
// Response shape
[
  { label: 'Article', value: 'uuid-1' },
  { label: 'Blog Post', value: 'uuid-2' },
  { label: 'Page', value: 'uuid-3' },
];
```

Sorted by name. No pagination (content type count is expected to be small).

### Modified Endpoints

All three field-related endpoints need `RELATION` and `MULTIRELATION` in their `VALID_FIELD_TYPES`:

- `POST /api/content-types` (inline field creation)
- `POST /api/content-types/[id]/fields` (add field)
- `PUT /api/content-types/[id]/fields/[fieldId]` (update field)

Entry create/update endpoints (`POST /api/content-entries`, `PUT /api/content-entries/[id]`) are unchanged — they already call `validateEntryData()` which will have the new cases.

## Field Definition UI

### `#type-options` Slot Content

When the field type is `RELATION` or `MULTIRELATION`, the `#type-options` slot in `FieldModal.vue` renders a "Target Content Types" picker:

- **Label:** "Target Content Types"
- **Chips area:** Shows selected content types as removable chips (blue background, × to remove)
- **Dropdown:** `USelect` with placeholder "Add content type..." listing all available content types (fetched from `GET /api/content-types/options`), excluding already-selected ones
- **Validation:** At least one target required — the parent page's save handler should check this before emitting

### Both Pages

Both `pages/content-types/[id].vue` and `pages/content-types/new.vue` add the relation type-options alongside the existing SELECT choices handling in their `#type-options` slot:

```
v-if type === 'SELECT' → choices input
v-else-if type === 'RELATION' || type === 'MULTIRELATION' → target content types picker
```

### Options Format

The slot receives/updates options in the format:

```json
{ "targetContentTypeIds": ["uuid-1", "uuid-2"] }
```

This is the same format stored in the database — no transformation needed.

## Testing

### Integration Tests

Add to `server/api/content-types/content-types.test.ts`:

- Create a content type with a RELATION field (with targetContentTypeIds)
- Create a content type with a MULTIRELATION field
- Reject RELATION field without targetContentTypeIds
- Reject RELATION field with non-existent targetContentTypeId

Add to `server/api/content-entries/content-entries.test.ts`:

- Create entry with valid RELATION value (contentTypeId + entryId exist)
- Create entry with valid MULTIRELATION value (array of references)
- Reject RELATION value with wrong contentTypeId (not in allowed targets)
- Reject RELATION value with non-existent entryId
- Reject MULTIRELATION with duplicate entryIds
- Accept null RELATION value for non-required field
- Accept empty array for MULTIRELATION

Test the options endpoint:

- `GET /api/content-types/options` returns expected format

### Manual Testing

- Add a RELATION field via the modal — verify chips UI works
- Add a MULTIRELATION field — verify same chips UI
- Edit a relation field — verify target types are shown and editable
- Verify at least one target is required to save
