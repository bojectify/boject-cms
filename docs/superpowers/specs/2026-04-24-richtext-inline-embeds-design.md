# RICHTEXT Inline Embeds (Dynamic Layer)

## Overview

Rebuild the deleted `CmsEmbed` Tiptap node against the dynamic `ContentEntry` layer so editors can reference another content entry **inline** inside a RICHTEXT body. Closes GitHub issue #45 and fills the gap left by commit `e8571d8` (removed the hardcoded rugby-model embed).

Extends the original proposal in #45 with a **per-field allow-list** on the RICHTEXT field definition, mirroring the `targetContentTypeIds` pattern already used by RELATION / MULTIRELATION. Inline embeds become opt-in: a RICHTEXT field with no configured targets cannot embed anything, keeping the feature off by default and giving schema authors editorial control over what's legal inside each body.

## Goals

- A `cmsEmbed` Tiptap node that stores `{ contentTypeId, entryId }` — shape-identical to a RELATION value — and renders the target's `entryTitle` + content type badge inline.
- A chip allow-list on the RICHTEXT field editor (shared UI with RELATION's target picker) that configures which content types may be embedded in this field.
- Server-side enforcement: `validateEntryData` walks the RICHTEXT JSON and rejects any `cmsEmbed` whose `contentTypeId` is outside the field's allow-list.
- Portable round-trip: `scripts/content-bundle/portable.ts` rewrites `cmsEmbed` node refs on export/import the same way it handles RELATION refs today.

## Non-Goals

- Embedding anything that isn't a `ContentEntry` — files, external URLs, and images are already covered by Tiptap's Image and Link nodes.
- Authoring affordances beyond pick / render / delete. No drag-reordering, no inline-attribute editing beyond re-picking the target.
- Cascade semantics when an embedded entry is deleted or archived. Dangling-reference handling is shared across RELATION / MULTIRELATION / cmsEmbed and tracked under #19.
- Bulk migration of existing RICHTEXT bodies. Existing fields have no embeds (the old node was removed in #44), so there's nothing to migrate.

## Schema & Field Options

No Prisma migration. The allow-list lives on the existing `ContentTypeField.options` JSONB column.

```ts
// options shape for RICHTEXT fields
{
  targetContentTypeIds?: string[]; // empty / missing = no embeds permitted
}
```

**Empty-list semantics.** For RICHTEXT, `[]` or `undefined` means **no embeds allowed** — the inline-embed toolbar button is hidden, and any stray `cmsEmbed` node is rejected by server validation. This differs deliberately from RELATION, where an empty list is meaningless (a relation without targets can't resolve anything, so the picker treats undefined as "any type"). Embeds are an opt-in authoring affordance; the safe default is off.

**Self-reference.** The field's own content type may appear in its allow-list — a Page body embedding another Page is legal.

**Tightening the list later.** Removing a content type from the allow-list does NOT retroactively invalidate existing bodies. `validateEntryData` only checks embeds on write, so a published body with a now-disallowed embed keeps rendering until the editor next saves that entry — at which point the save fails with a clear 400. We explicitly avoid option (c) "hard-reject on read" because it would silently break live sites. Option (b) "warn on next save" is out of scope for this spec; editors see the normal validation error.

## Tiptap Node

New extension at `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`:

- `name: 'cmsEmbed'`, inline, atom.
- Attributes: `{ contentTypeId: string, entryId: string }`.
- HTML serialisation: `<span data-cms-embed data-content-type-id data-entry-id>` for round-trip safety.
- Node view (Vue): fetches `/api/content-entries/:id` on mount, caches via the existing `useRelationResolver` composable (which already dedupes by `{ contentTypeId, entryId }`), renders `{entryTitle}` with a content-type-name badge. Loading / missing-entry states mirror `RelationField.vue`.

Registered conditionally in `RichTextEditor.vue` — the editor props gain an optional `targetContentTypeIds?: string[]`, and the extension is only added when the list is non-empty. This keeps the toolbar button hidden and the paste/parse path inert for fields with embeds disabled.

## Field Editor UI

The FieldModal's `#type-options` slot gains a RICHTEXT branch that reuses the same chip-list pattern as RELATION:

- Chips for each selected content type with an `×` to remove.
- "Add type" popover listing content types not yet selected, filtered against `/api/content-types/options`.
- Stored under `options.targetContentTypeIds` on save.

Concretely: extract the existing chip block from `pages/content-types/[id]/index.vue:510-580` (and its clone in `pages/content-types/new.vue`) into a small shared component — e.g. `components/content-type-chip-picker/ContentTypeChipPicker.vue` — and render it for both RELATION/MULTIRELATION and RICHTEXT. This removes the duplication that exists today across the two pages.

Empty state: if no types are selected, a hint reads "No inline embeds will be allowed in this field. Add a content type to enable inline embeds."

## Entry Editor Integration

`mapFieldToConfig` (already used for the entry editor) passes `targetContentTypeIds` through on the `richtext` field config. `ContentEditor.vue` forwards it to `RichTextEditor` as a prop. No new field type — the existing `RichtextFieldConfig` gains an optional `targetContentTypeIds?: string[]`.

The toolbar's "Insert embed" button opens the existing `EntryPickerModal` with the field's `targetContentTypeIds`. On pick, the node is inserted at the cursor with the resolved `{ contentTypeId, entryId }`. Edit = re-open the picker; remove = standard Tiptap node delete.

## Server Validation

Extend `validateEntryData` (`server/utils/validateEntryData.ts:103`, the `RICHTEXT` case) to walk the ProseMirror JSON:

- Traverse the `content` tree; for each node with `type === 'cmsEmbed'`:
  - If the field has no `targetContentTypeIds` (or the list is empty) → reject with 400 "Inline embeds are not allowed in this field."
  - If the embed's `contentTypeId` is not in the allow-list → reject with 400 "Inline embed references a content type not allowed in this field."
  - If `contentTypeId` / `entryId` are missing or not strings → reject with 400 "Invalid inline embed."

No referential-integrity check (does the entry exist?). RELATION fields don't do that either — dangling references are a system-wide concern handled separately (#19).

## Portable Round-Trip

Extend `scripts/content-bundle/portable.ts` with a RICHTEXT walker analogous to the RELATION/MULTIRELATION rewriters already there:

- **Export (portable mode):** for each `cmsEmbed` node, replace `{ contentTypeId, entryId }` with `{ contentTypeIdentifier, entrySlug | entryTitle }`. Reuses the same lookup used by portable RELATION export.
- **Import (portable mode):** two-pass — first pass inserts content types + entries, second pass resolves portable refs. The RICHTEXT walker is run in the second pass alongside RELATION resolution, against the already-imported entries.

`targetContentTypeIds` on the field itself is stored as content type identifiers in portable mode and resolved back to IDs on import, same as RELATION field options.

## Tests

**Unit**

- `validateEntryData` RICHTEXT case: allow-list empty → reject any cmsEmbed; disallowed contentTypeId → reject; allowed contentTypeId → pass; malformed embed node → reject.
- `portable.ts` walker: round-trip a body with embeds; identifier-based export, ID-based import.

**Integration**

- `POST /api/content-entries` with a RICHTEXT body containing a permitted embed → 201.
- Same with a disallowed embed → 400.
- Tighten the allow-list via `PUT /api/content-types/[id]/fields/[fieldId]`, then save an entry whose body contains a now-disallowed embed → 400. Saves that don't touch the embed path continue to work until they hit save.

**Storybook**

- `RichTextEditor` story with `targetContentTypeIds` set → embed toolbar button visible; picker opens with filtered types.
- Same component with no `targetContentTypeIds` → button hidden, pasted cmsEmbed HTML is stripped.

## Migration / Rollout

- Add the enum-safe `cmsEmbed` Tiptap node.
- Ship the field-editor chip picker and `validateEntryData` walker together. Until a field explicitly lists targets, nothing changes for existing RICHTEXT fields (they stay embed-free, matching current reality).
- No data migration required.

## Open Questions

- **Picker UX when `targetContentTypeIds.length === 1`.** Skip the type-tabs step? EntryPickerModal already degrades gracefully with one type, so probably no change — worth eyeballing during implementation.
- **Rendering a deleted target.** Node view shows `(deleted)` with a muted style, same as `RelationField.vue`'s missing-entry state. Confirm copy with design.
