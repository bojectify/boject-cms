# RICHTEXT Field Type

## Overview

Add `RICHTEXT` to the dynamic content type field system, allowing users to add rich text fields (Tiptap editor) to any content type. No new components — reuses the existing `RichTextEditor.vue` and `RichtextFieldConfig` type.

## Changes

### Prisma Schema

Add `RICHTEXT` to the `FieldType` enum in `prisma/schema/contentType.prisma`. Migration adds the enum value via `ALTER TYPE`.

### Server Validation

Add a `RICHTEXT` case to `validateEntryData()` in `server/utils/validateEntryData.ts`:

- Accepts an object (ProseMirror JSON document) or null
- Rejects strings, numbers, booleans
- No deep validation of the ProseMirror structure (same approach as the Article body field)

### Field Type Options

Add `{ label: 'Rich Text', value: 'RICHTEXT' }` to `fieldTypeOptions` in:

- `pages/content-types/new.vue`
- `pages/content-types/[id].vue`

### Entry Editor Mapping

Add `RICHTEXT` case to `mapFieldToConfig()` in:

- `pages/content-types/[id]/entries/new.vue`
- `pages/content-types/[id]/entries/[entryId].vue`

Returns `{ type: 'richtext', key: field.identifier, label: field.name }`.

### Field Add Endpoint

Add `RICHTEXT` to the `VALID_FIELD_TYPES` set in `server/api/content-types/[id]/fields/index.post.ts`.

### Constraints

No limit on how many RICHTEXT fields a content type can have (unlike ENTRY_TITLE which requires exactly one, or SLUG which allows at most one).

### Tests

Extend existing content-type and content-entry integration tests to cover:

- Adding a RICHTEXT field to a content type
- Creating/updating entries with RICHTEXT data (ProseMirror JSON)
- Validation: rejecting non-object values for RICHTEXT fields
