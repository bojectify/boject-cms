# Relation Entry Editor — Entry Picker, Cards & Sliding Pane

## Overview

Add the entry-level UI for RELATION and MULTIRELATION fields in dynamic content entries. Users can link existing entries via a picker modal, create new entries via a sliding pane, edit linked entries in-place, and reorder MULTIRELATION items via drag-and-drop. Inspired by Contentful's stacked-pane editing pattern.

## Scope

**In scope:**

- `RelationField.vue` — single entry card + "Add entry" empty state
- `MultiRelationField.vue` — draggable list of entry cards + "Add entry"
- `EntryPickerModal.vue` — modal for searching/selecting existing entries from allowed target types
- `EntryEditorPane.vue` — sliding full-screen pane for creating/editing a related entry
- New field config types (`DynamicRelationFieldConfig`, `DynamicMultirelationFieldConfig`)
- `#field` scoped slot on `ContentEditor` for custom field rendering
- `mapFieldToConfig` updates in dynamic entry pages
- Entry picker API support

**Out of scope:**

- Updating hardcoded model pages (articles, navigations, etc.) — deferred to model migration
- Deep nesting (editing a relation within a relation inside the pane)
- Entry deletion from within the pane
- Existing `RelationFieldConfig`/`MultirelationFieldConfig` with `optionsEndpoint` — left as-is for hardcoded models

## Components

### `RelationField.vue`

Renders a RELATION field in the entry editor.

**Props:**

| Prop              | Type                                                 | Description                                     |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `label`           | `string`                                             | Field display name                              |
| `required`        | `boolean`                                            | Whether the field is required                   |
| `value`           | `{ contentTypeId: string; entryId: string } \| null` | Current linked entry reference                  |
| `entryTitle`      | `string \| null`                                     | Display title of the linked entry               |
| `contentTypeName` | `string \| null`                                     | Display name of the linked entry's content type |

**Emits:**

| Event    | Payload | Description                 |
| -------- | ------- | --------------------------- |
| `add`    | —       | User clicked "Add entry"    |
| `edit`   | —       | User clicked the entry card |
| `remove` | —       | User clicked remove/unlink  |

**States:**

- **Empty:** Dashed border card with "+" icon and "Add entry" text. Clicking emits `add`.
- **Filled:** Solid card showing content type initial (colored circle), entry title, content type name, chevron. Clicking the card emits `edit`. A small remove button (x or unlink icon) emits `remove`.

### `MultiRelationField.vue`

Renders a MULTIRELATION field in the entry editor.

**Props:**

| Prop    | Type                                                                                             | Description                    |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `label` | `string`                                                                                         | Field display name             |
| `items` | `Array<{ contentTypeId: string; entryId: string; entryTitle: string; contentTypeName: string }>` | Ordered list of linked entries |

**Emits:**

| Event     | Payload                                                    | Description                    |
| --------- | ---------------------------------------------------------- | ------------------------------ |
| `add`     | —                                                          | User clicked "Add entry"       |
| `edit`    | `index: number`                                            | User clicked an entry card     |
| `remove`  | `index: number`                                            | User clicked remove on a card  |
| `reorder` | `items: Array<{ contentTypeId: string; entryId: string }>` | Drag-and-drop reorder complete |

**Rendering:**

- Uses `vuedraggable` for drag-and-drop reordering (same pattern as field reordering)
- Each entry card has: drag handle (left), content type initial circle, entry title, content type name, chevron (right)
- "Add entry" dashed card at the bottom
- Clicking a card emits `edit(index)`, clicking "Add entry" emits `add`

### `EntryPickerModal.vue`

Modal for selecting an existing entry to link, or creating a new one.

**Props:**

| Prop                   | Type       | Description              |
| ---------------------- | ---------- | ------------------------ |
| `open`                 | `boolean`  | Controls visibility      |
| `targetContentTypeIds` | `string[]` | Allowed content type IDs |

**Emits:**

| Event    | Payload                                                          | Description              |
| -------- | ---------------------------------------------------------------- | ------------------------ |
| `select` | `{ contentTypeId: string; entryId: string; entryTitle: string }` | User selected an entry   |
| `create` | `contentTypeId: string`                                          | User wants to create new |
| `close`  | —                                                                | Close the modal          |

**Behaviour:**

- Fetches content type names for the target IDs (from `/api/content-types/options` or inline)
- When multiple target types: tab bar at top to filter by type, "All" tab as default
- Search input filtering entries by title (client-side filter on fetched results, or query param if list is large)
- Scrollable list of entry cards (entry title + content type badge)
- Clicking an entry emits `select` and closes
- "Create new [Type]" button at the bottom — if multiple types, a dropdown to pick which type. Emits `create(contentTypeId)`.
- Fetches entries from `GET /api/content-entries?contentTypeId=X` for each target type

### `EntryEditorPane.vue`

Sliding pane overlay for creating or editing a related entry.

**Props:**

| Prop            | Type             | Description                                    |
| --------------- | ---------------- | ---------------------------------------------- |
| `open`          | `boolean`        | Controls visibility (triggers slide animation) |
| `contentTypeId` | `string`         | The content type of the entry                  |
| `entryId`       | `string \| null` | Entry ID for editing, null for creating        |

**Emits:**

| Event   | Payload                                                          | Description                  |
| ------- | ---------------------------------------------------------------- | ---------------------------- |
| `close` | —                                                                | User clicked back/cancel     |
| `saved` | `{ contentTypeId: string; entryId: string; entryTitle: string }` | Entry was saved successfully |

**Rendering:**

- Fixed position overlay covering the full viewport
- Left edge: narrow sliver (~40px) showing the parent page peeking through (visual "book pages" effect). Clicking this sliver acts as cancel/close.
- Right side: white pane with shadow, containing:
  - **Header:** Back arrow (cancel) | Content type name link (opens content type definition in new tab) | Entry title (centered) | Save button
  - **Body:** Scrollable area with the full `ContentEditor` for this entry's fields
- CSS transition: slides in from the right when `open` becomes true
- Uses `useContentEntryEditor` composable for data fetching, form state, and save
- Save button calls the composable's `save()`, then emits `saved` with the entry details
- Back arrow emits `close` without saving
- For new entries: title shows "New [ContentTypeName]", save creates via POST, emits `saved` with the new entry's ID

### Nested Relation Fields

When the `EntryEditorPane` renders a `ContentEditor` that itself has RELATION/MULTIRELATION fields, those fields render as cards but **do not** open a nested pane. Instead, clicking them navigates to the entry in a new tab/window. This prevents infinite pane nesting. The pane only goes one level deep.

## Field Config Types

Add to `types/contentEditor.ts`:

```typescript
export interface DynamicRelationFieldConfig {
  type: 'dynamic-relation';
  key: string;
  label: string;
  required?: boolean;
  targetContentTypeIds: string[];
}

export interface DynamicMultirelationFieldConfig {
  type: 'dynamic-multirelation';
  key: string;
  label: string;
  targetContentTypeIds: string[];
}
```

Add both to the `FieldConfig` union.

## ContentEditor Scoped Slot

Add a `#field` scoped slot to `ContentEditor.vue`:

```vue
<slot
  name="field"
  :field="field"
  :value="state[field.key]"
  :update="(val) => (state[field.key] = val)"
>
  <!-- default: existing field rendering (text, textarea, select, etc.) -->
</slot>
```

The slot receives:

- `field` — the `FieldConfig` object
- `value` — current value from form state
- `update` — callback to update the value

If the parent provides the slot, it can intercept specific field types (dynamic-relation, dynamic-multirelation) and render them with the new components. For all other types, the slot falls through to the default content.

## Dynamic Entry Page Integration

Both `pages/content-types/[id]/entries/new.vue` and `[entryId].vue`:

### mapFieldToConfig

Add cases for RELATION and MULTIRELATION:

```typescript
case 'RELATION': {
  const opts = field.options as { targetContentTypeIds?: string[] } | null;
  return {
    type: 'dynamic-relation',
    key: field.identifier,
    label: field.name,
    required: field.required,
    targetContentTypeIds: opts?.targetContentTypeIds ?? [],
  };
}
case 'MULTIRELATION': {
  const opts = field.options as { targetContentTypeIds?: string[] } | null;
  return {
    type: 'dynamic-multirelation',
    key: field.identifier,
    label: field.name,
    targetContentTypeIds: opts?.targetContentTypeIds ?? [],
  };
}
```

### Page-level state

Each entry page manages:

- `pickerOpen` ref + which field triggered it
- `paneOpen` ref + content type ID + entry ID (or null for create)
- Handlers for `add`, `edit`, `remove`, `select`, `create`, `saved`, `reorder`

### #field slot usage

```vue
<ContentEditor v-model:state="formState" :fields="editorFields" ...>
  <template #field="{ field, value, update }">
    <RelationField
      v-if="field.type === 'dynamic-relation'"
      :label="field.label"
      :required="field.required"
      :value="value"
      :entry-title="resolvedTitles[field.key]"
      :content-type-name="resolvedTypeNames[field.key]"
      @add="openPicker(field.key)"
      @edit="openPane(value.contentTypeId, value.entryId)"
      @remove="update(null)"
    />
    <MultiRelationField
      v-else-if="field.type === 'dynamic-multirelation'"
      :label="field.label"
      :items="resolvedMultiItems[field.key]"
      @add="openPicker(field.key)"
      @edit="(idx) => openPane(value[idx].contentTypeId, value[idx].entryId)"
      @remove="(idx) => { const arr = [...value]; arr.splice(idx, 1); update(arr); }"
      @reorder="(items) => update(items)"
    />
  </template>
</ContentEditor>
```

### Resolving entry titles

The entry page needs to resolve `{ contentTypeId, entryId }` references into display data (entry title, content type name). This requires fetching entry details for each linked reference. Options:

- Fetch on mount and when references change
- Use a lightweight endpoint or batch fetch
- Cache results to avoid re-fetching on reorder

Implementation: a `useRelationResolver` composable that takes the current form state and field definitions, returns reactive maps of `{ entryTitle, contentTypeName }` keyed by field key (for RELATION) or field key + index (for MULTIRELATION). Fetches entry details via `GET /api/content-entries/[id]` and content type names from the already-fetched content type data.

## User Flows

### Link an existing entry (RELATION)

1. User sees empty "Add entry" card
2. Clicks it → `EntryPickerModal` opens
3. Browses/searches entries, clicks one
4. Modal closes, card appears with entry title
5. Parent form state updated with `{ contentTypeId, entryId }`

### Create a new related entry

1. User clicks "Add entry" → picker modal opens
2. Clicks "Create new Carousel" button
3. Modal closes, `EntryEditorPane` slides in
4. User fills out the new entry form, clicks Save
5. Pane saves the entry via POST, emits `saved`
6. Pane closes, card appears in the field
7. Parent form state updated with the new entry's reference

### Edit a linked entry

1. User clicks an existing entry card
2. `EntryEditorPane` slides in with that entry loaded
3. User edits, clicks Save
4. Pane saves via PUT, emits `saved` (with potentially updated title)
5. Pane closes, card updates if title changed

### Reorder MULTIRELATION entries

1. User drags an entry card by its handle
2. `vuedraggable` handles the reorder
3. `MultiRelationField` emits `reorder` with the new order
4. Parent updates form state array order
5. Order is persisted when the parent entry is saved

### Unlink an entry

1. User clicks the remove/unlink button on an entry card
2. For RELATION: parent sets value to `null`
3. For MULTIRELATION: parent splices the item from the array
4. The entry itself is NOT deleted — just unlinked

## Testing

No new integration tests for the API — entry validation was covered in the previous spec. This is a UI-only spec. Manual testing:

- Add a RELATION field to a content type, create an entry, verify picker opens
- Select an existing entry, verify card appears
- Click the card, verify pane slides in with correct fields
- Save in the pane, verify pane closes
- Create new from picker, verify pane opens in create mode
- MULTIRELATION: add multiple entries, verify reordering works
- MULTIRELATION: remove an entry, verify it unlinks without deleting
- Verify nested relation fields in the pane don't open nested panes
