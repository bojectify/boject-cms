# Field Modal — Add & Edit Fields via Modal

## Overview

Replace the inline "Add Field" form on content type pages with a modal dialog. Reuse the same modal for editing existing fields. This consolidates field creation and editing into a single `FieldModal.vue` component with a `#type-options` slot for type-specific configuration UI.

## Motivation

The current inline "Add Field" form at the bottom of the field list works for creation but has no equivalent for editing. Moving to a modal:

- Provides a shared UI for both adding and editing fields
- Creates a natural extension point (via slots) for type-specific options — important for upcoming relational fields, rich text toolbar config, etc.
- Cleans up the content type page by removing the inline form

## Component: `FieldModal.vue`

A single modal component used in both add and edit modes.

### Props

| Prop               | Type                    | Description                                                   |
| ------------------ | ----------------------- | ------------------------------------------------------------- |
| `open`             | `boolean`               | Controls modal visibility                                     |
| `mode`             | `'add' \| 'edit'`       | Determines which fields are editable and labels               |
| `field`            | `FieldData \| null`     | Existing field data when editing, null when adding            |
| `fieldTypeOptions` | `Array<{label, value}>` | Available field types for the type dropdown                   |
| `entryCount`       | `number`                | Number of entries using this content type (for edit info bar) |

### Emits

| Event    | Payload             | Description                 |
| -------- | ------------------- | --------------------------- |
| `close`  | —                   | Close the modal             |
| `save`   | `FieldFormData`     | Field data to create/update |
| `delete` | `string` (field id) | Delete the field            |

### Slots

| Slot            | Slot Props                                                                  | Description                                                                                                     |
| --------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `#type-options` | `{ type: string, options: unknown, updateOptions: (val: unknown) => void }` | Type-specific configuration UI. Receives current type, current options value, and a callback to update options. |

### Add Mode

- Title: "Add Field"
- Fields: Name (text input), Identifier (auto-generated from name, editable, camelCase hint), Type (dropdown), Required (toggle)
- `#type-options` slot renders below the Type/Required row
- Footer: Cancel, **Add Field** button
- Closes on successful save (parent handles the API call and closes)

### Edit Mode

- Title: "Edit Field" with type badge (e.g. green pill showing "DATETIME")
- Info bar below header: identifier (read-only text), entry count ("Used in: N entries")
- Fields: Name (editable), Required (toggle)
- Identifier: not editable, shown in info bar only
- Type: not editable, shown as badge in header only
- `#type-options` slot renders below the editable fields
- Danger zone at bottom: red separator, "Delete this field" label, warning text ("Data in N entries will be preserved but hidden"), Delete button
- Danger zone hidden for ENTRY_TITLE fields (cannot be deleted)
- Footer: Cancel, **Save Changes** button

### Auto-generated Identifier (Add Mode)

When adding a field, the identifier auto-generates from the name using `toCamelCase()` (same logic as the current inline form). The user can manually override by editing the identifier input, which sets an `identifierTouched` flag to stop auto-generation — same pattern as the content type create page.

## Content Type Pages Changes

### `pages/content-types/[id].vue` (Edit Content Type)

- Remove the inline "Add Field" form (the `<USeparator label="Add Field" />` section and everything below it)
- Add an **"Add Field"** button below the field list (or in the Fields section header)
- Each field card in the draggable list gets a **three-dot menu** (`UDropdownMenu`) with:
  - **Edit** — opens the edit modal populated with that field's data
  - **Delete** — calls the delete endpoint directly (with confirmation if entries exist)
- Clicking "Add Field" opens `FieldModal` in add mode
- Clicking "Edit" opens `FieldModal` in edit mode with the field data
- On `save` emit: parent calls POST (add) or PUT (edit) endpoint, refreshes, closes modal
- On `delete` emit: parent calls DELETE endpoint, refreshes, closes modal
- `#type-options` slot: renders choices input when type is SELECT, empty otherwise

### `pages/content-types/new.vue` (New Content Type)

- Remove the inline "Add Field" form
- Add an "Add Field" button below the field list
- Clicking opens `FieldModal` in add mode
- On `save` emit: push field to local `fields` array, close modal
- No edit modal needed here (fields are draft, not yet persisted) — but for consistency, clicking a field card's edit menu opens the modal in edit mode against the local array
- No delete API call — just splice from local array
- `#type-options` slot: renders choices input when type is SELECT, empty otherwise

### Field Card Three-Dot Menu

Replace the current delete-only trash icon button on each field card with a `UDropdownMenu` triggered by a three-dot icon (`i-lucide-ellipsis`). Menu items:

- **Edit** — opens edit modal
- **Delete** — deletes the field (with confirmation toast/dialog if entries exist, except on the new page where it's just a local array splice)

## Server Changes

### `PUT /api/content-types/[id]/fields/[fieldId]`

Add `RICHTEXT` to the `VALID_FIELD_TYPES` set (currently missing — only the create endpoint was updated). This endpoint already supports updating `name`, `required`, and `options`, which is everything the edit modal needs.

### Entry Count for Info Bar

The edit modal needs the entry count for the content type. This is already available from the `GET /api/content-types/[id]` response which includes `_count: { entries: number }`. No new endpoint needed.

## Nuxt UI Components Used

- `UModal` — modal container (same pattern as `CmsEmbedModal.vue`)
- `UFormField` — form field wrappers
- `UInput` — text inputs
- `USelect` — type dropdown
- `USwitch` — required toggle
- `UButton` — action buttons
- `UBadge` — type badge in edit header
- `UDropdownMenu` — three-dot menu on field cards

## Testing

No new integration tests needed — the API endpoints are unchanged. The modal is a pure UI refactor of existing functionality. The slot mechanism is a Vue template concern, not testable via API integration tests.

Manual testing:

- Add a field via modal on both new and edit content type pages
- Edit a field via modal (verify name and required save, identifier and type are read-only)
- Delete a field via the modal danger zone and via the three-dot menu
- Verify ENTRY_TITLE fields cannot be deleted
- Verify SELECT type shows choices input in the `#type-options` slot
- Verify drag-and-drop reordering still works
- Verify auto-generated identifier from name in add mode
