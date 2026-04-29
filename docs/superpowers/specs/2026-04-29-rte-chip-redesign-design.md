# RTE chip redesign + link target/rel + focus outline (issue #115, scope expansion)

This spec extends `docs/superpowers/specs/2026-04-29-rte-editor-presentation-fixes-design.md`. The original spec scoped three small presentation fixes (heading styling, cmsLink underline + chain icon, toolbar button colours) plus a Storybook story. After implementation but before push, the user reversed two brainstorming decisions and added new scope. This spec supersedes the original for the affected surfaces and is the source of truth for the final PR.

The work continues on the existing branch `fix/rte-editor-presentation` and merges as a single squashed PR closing #115.

## What stays from the first spec

- **Task 1**: `RichTextEditor.stories.ts` Storybook story (visual review surface). Sample doc shape will be migrated to the new node shapes during this work, but the file itself stays.
- **Task 2**: hand-rolled scoped typography for headings, paragraphs, lists, blockquote, code. Stays as-is.
- **Task 4 (partial)**: `color="neutral"` on the table button and embed button. Stays.

## What this spec changes from the first spec

- **Task 3 reverted**: cmsLink underline + chain-icon mark styling, plus the generic `:deep(.ProseMirror a)` rule. cmsLink is no longer a mark; external links are no longer plain `<a>` elements.
- **Task 4 partial revert**: the `:color="editor.isActive('link') ? 'primary' : 'neutral'"` binding on the external-link toolbar button reverts to static `color="neutral"`. There is no `link` mark to be active in.

## Architecture

The rich text editor moves to a uniform **chip-based atom-node model** for all entry references and external links:

- `cmsEmbed` (existing): inline atom node, gains optional `label` attr.
- `cmsLink` (was a Tiptap mark): rewritten as an inline atom node with `label`, `target`, `rel` attrs.
- `externalLink` (replaces `@tiptap/extension-link`): new inline atom node with `href`, `label`, `target`, `rel`.

All three render via Vue node views as visually consistent chips. Clicking any chip opens its respective edit modal preloaded with current attrs. The "select text + click toolbar button to wrap" interaction is removed; toolbar buttons are insert-only.

`feat/richtext-references` (PR #119) only landed days ago and no production data, fixtures, or starter bundles use the `cmsLink` mark. Nor has this branch been pushed. We do a clean schema swap with no migration shim.

## Scope

### 1. Tiptap extensions

Three sibling files under `apps/cms/components/rich-text-editor/extensions/`:

#### `CmsEmbed.ts` (modify in place)

Existing inline atom node. Add a single new attr:

```ts
addAttributes() {
  return {
    contentTypeId: { default: null, ... },
    entryId: { default: null, ... },
    contentTypeIdentifier: { default: null, ... },
    label: {                                              // NEW
      default: null,
      parseHTML: (el) => el.getAttribute('data-label'),
      renderHTML: (attrs) =>
        attrs.label ? { 'data-label': attrs.label as string } : {},
    },
  };
}
```

Existing `insertCmsEmbed` command continues to work; node view replaces the existing one with the extended click-to-edit version.

#### `CmsLink.ts` (rewrite — was a Mark, becomes a Node)

```ts
Node.create({
  name: 'cmsLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      contentTypeId: { default: null, ... },
      entryId: { default: null, ... },
      contentTypeIdentifier: { default: null, ... },
      label: { default: null, ... },
      target: { default: null, ... },        // '_self' | '_blank' | null
      rel: { default: null, ... },           // 'nofollow' | null (server may extend at render)
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-cms-link]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-cms-link': '' }), 0];
  },
  addCommands() {
    return {
      insertCmsLink: (attrs) => ({ commands }) =>
        commands.insertContent({ type: 'cmsLink', attrs }),
    };
  },
  addNodeView() { return VueNodeViewRenderer(CmsLinkNodeView); },
});
```

The previous `setCmsLink` / `unsetCmsLink` mark commands are removed. Server-side handling of `target='_blank'` adds `noopener noreferrer` to `rel` at render time (defence-in-depth — the editor only exposes a `nofollow` toggle).

#### `ExternalLink.ts` (new — replaces stock `@tiptap/extension-link`)

```ts
Node.create({
  name: 'externalLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: '', ... },             // required at validator layer
      label: { default: null, ... },
      target: { default: null, ... },
      rel: { default: null, ... },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-external-link]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-external-link': '' }), 0];
  },
  addCommands() {
    return {
      insertExternalLink: (attrs) => ({ commands }) =>
        commands.insertContent({ type: 'externalLink', attrs }),
    };
  },
  addNodeView() { return VueNodeViewRenderer(ExternalLinkNodeView); },
});
```

`@tiptap/extension-link` is removed from `RichTextEditor.vue`. `StarterKit.configure(...)` continues to drop `codeBlock`; `link` is also disabled to remove the duplicate-extension warning we noticed in the first spec's implementation (StarterKit already bundles a Link extension, which has been silently colliding with our explicit one).

### 2. Vue node-view chip components

Three components in `apps/cms/components/rich-text-editor/`:

#### `CmsEmbedNodeView.vue` (modify existing)

- Display text becomes `label || resolvedEntryTitle`.
- Root element gains `class="rich-text-editor__chip rich-text-editor__chip--embed"` plus type-specific icon (`i-lucide-at-sign` or similar atom symbol).
- Click handler: `event.stopPropagation()`, `editor.commands.setNodeSelection(getPos())`, then signals the parent editor to open the edit modal via a provide/inject token (`cmsEditorChipOpenEdit`).

#### `CmsLinkNodeView.vue` (new)

- Mirrors `CmsEmbedNodeView` for resolution + click handling.
- Display text: `label || resolvedEntryTitle`.
- Icon: `i-lucide-link-2` (chain).
- Same provide/inject signal token, with payload differentiating mode (`cmsLink` vs `cmsEmbed`).

#### `ExternalLinkNodeView.vue` (new)

- No resolver. Display text: `label || extractDomain(href)` (helper extracts hostname; falls back to full href if URL parse fails).
- Icon: `i-lucide-external-link`.
- Same click-to-edit handler.

#### Shared chip styling

Inside the existing `<style scoped>` block in `RichTextEditor.vue`. One `.rich-text-editor__chip` base class plus `--embed` / `--link` / `--external` modifiers for icon + accent. Visual treatment: `inline-flex` row of icon + text, rounded background (subtle primary tint), small horizontal padding, hover state, focus ring tied to ProseMirror's `.ProseMirror-selectednode` class.

#### Click-vs-select handling

ProseMirror's default click on an atom node creates a `NodeSelection`. To layer "open modal" on top without breaking deletion (Backspace on selected node), each node view's root:

1. Listens for click with `@click.stop`.
2. Calls `editor.commands.setNodeSelection(getPos())` so the node is the active selection (Backspace etc. work).
3. Calls the injected `openEditModal({ nodeType, attrs, pos })` function on the parent editor.

The modal-open signal carries `pos` so the modal's save callback can `editor.commands.deleteRange + insertContentAt` to replace in place.

### 3. Edit modals

#### `EntryPickerModal.vue` (extend existing)

New props:

```ts
interface EntryPickerModalProps extends BasicComponentProps {
  open: boolean;
  targetContentTypeIds: string[];
  mode?: 'cmsEmbed' | 'cmsLink'; // default 'cmsEmbed'
  selectedEntry?: { contentTypeId: string; entryId: string }; // preselect
  initialOptions?: {
    // cmsLink edit only
    label?: string;
    target?: '_self' | '_blank' | null;
    rel?: 'nofollow' | null;
  };
}
```

Behavioural additions:

- When `selectedEntry` is set: matching row gets a primary-coloured ring + `scrollIntoView({ block: 'nearest' })` on modal open.
- When `mode === 'cmsLink'`: `<LinkOptionsForm>` sub-component renders below the entry list.
- Header label: `'Insert embed' | 'Edit embed' | 'Insert link' | 'Edit link'` driven by `(mode, selectedEntry ? 'edit' : 'insert')`.
- Footer changes:
  - `Save` button (disabled until an entry is selected). Replaces single-tap-to-select on the entry row.
  - `Remove` button rendered only when `selectedEntry` is set; emits `remove`.
  - `Cancel` button.
  - "Create new..." popover stays.
- Existing `select` emit retained for insert mode (clicking a row selects it; `Save` confirms). New `update` emit for edit mode with full `{ contentTypeId, entryId, entryTitle, label?, target?, rel? }`. New `remove` emit.

If the file grows past ~300 lines, lift `LinkOptionsForm` to its own file under `apps/cms/components/link-options-form/`.

#### `ExternalLinkModal.vue` (new)

Standalone modal under `apps/cms/components/external-link-modal/`. Fields:

- **URL** (required) — validated client-side via `new URL(value)` constructor, with allowed schemes `http`, `https`, `mailto`, `tel`. Inline error below the input.
- **Display text** (optional) — placeholder shows the auto-derived domain.
- **Open in new tab** (toggle).
- **Add nofollow** (toggle).

Footer: `Save` (disabled while URL invalid); `Remove` rendered only in edit mode; `Cancel`.

Emits: `save: { href, label?, target?, rel? }`, `remove`, `close`.

#### `LinkOptionsForm.vue` (shared sub-component)

Three fields (Display text, target toggle, rel toggle), `v-model` of `{ label, target, rel }`. Used inside both `EntryPickerModal` (cmsLink mode) and `ExternalLinkModal`. Pure presentational — no fetches, no provide/inject.

### 4. Toolbar interaction model

`RichTextEditor.vue` template changes:

- `i-lucide-at-sign` button (cmsEmbed insert): unchanged behaviour. Opens `EntryPickerModal` in `mode='cmsEmbed'`. On `select`, inserts a `cmsEmbed` node at cursor.
- `i-lucide-link-2` button (cmsLink insert): opens `EntryPickerModal` in `mode='cmsLink'`. On `select`, inserts a `cmsLink` node. The previous "select text first to wrap" guard (the `useToast` warning) is removed.
- `i-lucide-link` button (external link insert): opens `ExternalLinkModal`. Replaces the previous `window.prompt('URL')` flow. On `save`, inserts an `externalLink` node.

All three buttons revert to static `color="neutral"`. No `editor.isActive(...)` bindings — there are no marks for them to be active in.

The `i-lucide-link-2` button's `:color` binding (added on the `feat/richtext-references` branch) reverts to static `color="neutral"`.

The `:color` ternary bindings on the toggleable mark buttons (Bold / Italic / H1-H3 / lists / blockquote / code) stay — those marks still exist via StarterKit.

### 5. Server-side validators + walkers

Three pure-function modules in `apps/cms/server/utils/` collapse from dual nodes-and-marks walkers to nodes-only walkers:

- **`enrichRichtextEmbeds.ts`**: walks `cmsEmbed` and `cmsLink` nodes, stamping `contentTypeIdentifier` from a `contentTypeId` → `identifier` map. `externalLink` nodes are not enriched (no contentTypeId).
- **`collectRichtextReferences.ts`**: returns deduplicated `{ contentTypeId, entryId }` pairs from `cmsEmbed` + `cmsLink` nodes only. `externalLink` never appears in the output. Recursion-depth cap stays at 1000.
- **`validateEntryData.ts`** (RICHTEXT field section): rejects out-of-allow-list `cmsEmbed` and `cmsLink` nodes (allow-list is per-RICHTEXT-field via `targetContentTypeIds` and `linkTargetContentTypeIds` — unchanged). New: validates `externalLink.href` is a non-empty string parsing as a valid URL with one of the allowed schemes (`http`, `https`, `mailto`, `tel`); 400 on failure.

#### Server-side rel injection (defence-in-depth)

When the validator processes an `externalLink` or `cmsLink` node with `target='_blank'`:

- If `rel` is null/empty: stamp `rel='noopener noreferrer'`.
- If `rel='nofollow'`: stamp `rel='nofollow noopener noreferrer'`.

The editor only ever exposes a `nofollow` toggle to authors. `noopener noreferrer` is stamped by the server so external consumers reading `body.json` always see the safe `rel` value, regardless of how the editor sent it.

### 6. GraphQL surface

`RichText { json: JSON!, references: [ContentEntry!]! }` interface — unchanged at the type level. The `references` resolver continues to call `collectRichtextReferences`, which now sources from nodes only.

External GraphQL consumers see the same surface. The JSON inside `body.json` changes shape:

- `cmsLink` moves out of `text.marks[]` into its own inline atom node.
- `externalLink` replaces the stock `link` mark.
- `cmsEmbed` gains an optional `label` attr.

No Pothos schema changes. No GraphQL test changes beyond updating fixture JSON shapes in existing tests.

### 7. Focus outline fixes

Two scoped CSS adjustments in `RichTextEditor.vue`:

- Move padding from the `<EditorContent>` wrapper into the editable root: drop `p-4` from the `EditorContent` class binding, add `.rich-text-editor__content :deep(.ProseMirror) { @apply p-4; }`. The focus outline (rendered on the wrapper) now sits clear of the cursor at line start.
- Suppress H1 leading whitespace at the top of the editor: `.rich-text-editor__content :deep(h1:first-child) { @apply mt-0; }` so the outline doesn't intersect the H1's `mt-6`.

## Components index

| File                                                              | Change  | Responsibility                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`     | Modify  | Add optional `label` attr; existing logic unchanged.                                                                                                                            |
| `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`      | Rewrite | Mark → Node with `label` / `target` / `rel`.                                                                                                                                    |
| `apps/cms/components/rich-text-editor/extensions/ExternalLink.ts` | Create  | New atom node replacing stock `Link` mark.                                                                                                                                      |
| `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue`       | Modify  | Add label fallback + click-to-edit.                                                                                                                                             |
| `apps/cms/components/rich-text-editor/CmsLinkNodeView.vue`        | Create  | Chain-icon chip with click-to-edit.                                                                                                                                             |
| `apps/cms/components/rich-text-editor/ExternalLinkNodeView.vue`   | Create  | External-link-icon chip with click-to-edit.                                                                                                                                     |
| `apps/cms/components/rich-text-editor/RichTextEditor.vue`         | Modify  | Wire new extensions, modals, toolbar inserts; add `.rich-text-editor__chip` styles; revert Task 3 link mark CSS; revert Task 4 link button isActive binding; focus outline fix. |
| `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`  | Modify  | Update sample doc to nodes-only shape.                                                                                                                                          |
| `apps/cms/components/entry-picker-modal/EntryPickerModal.vue`     | Modify  | `mode`, `selectedEntry`, `initialOptions` props; preselect highlight + scroll-into-view; Save / Remove footer; `update` / `remove` emits.                                       |
| `apps/cms/components/external-link-modal/ExternalLinkModal.vue`   | Create  | URL + label + target + rel modal.                                                                                                                                               |
| `apps/cms/components/link-options-form/LinkOptionsForm.vue`       | Create  | Shared sub-component for the three link-options fields.                                                                                                                         |
| `apps/cms/server/utils/enrichRichtextEmbeds.ts`                   | Modify  | Nodes-only walker.                                                                                                                                                              |
| `apps/cms/server/utils/collectRichtextReferences.ts`              | Modify  | Nodes-only walker.                                                                                                                                                              |
| `apps/cms/server/utils/validateEntryData.ts` (RICHTEXT section)   | Modify  | Add `externalLink` validation + server-side rel injection.                                                                                                                      |

## Test plan

### Vitest unit (extend existing files)

- `enrichRichtextEmbeds.test.ts` — covers cmsEmbed + cmsLink + externalLink walking; rel injection on `target='_blank'`; missing/empty href rejection.
- `collectRichtextReferences.test.ts` — covers nodes-only path; externalLink ignored.
- `validateEntryData.test.ts` (RICHTEXT section) — covers externalLink href validation, scheme rejection (`javascript:` rejected, `mailto:` accepted), allow-list still enforced for cmsEmbed/cmsLink.

### Vitest integration

- `content-entries.test.ts` — existing richtext fixtures updated to nodes-only shape. End-to-end: save a body containing all three node types → fetch via REST + GraphQL → verify shape and `references` resolution.

### Storybook

- `RichTextEditor.stories.ts` `AllStyledNodes` story updated: sample doc switched to the new node shapes (no more `link` mark, no more `cmsLink` mark — instead `cmsEmbed`, `cmsLink`, `externalLink` atom nodes).
- **Skipped from this PR**: interaction stories for chip-click-to-edit. Those need MSW handler fixtures for `/api/content-entries` and `/api/content-types/options`, plus `unplugin-auto-import` shims for `useAuthedFetch` / `useRequestFetch` / `useToast`. That plumbing is real work that doesn't directly serve issue #115. See "Follow-ups" below.

### Manual smoke

- Insert each chip type via toolbar; verify modal pre-state correct.
- Click each existing chip type; verify modal opens with attrs preloaded.
- For chips with `selectedEntry`, verify highlight + scroll-into-view.
- Edit each chip's attrs (label / target / rel / URL / entry); verify Save replaces in place.
- Verify Remove deletes the chip.
- External link: try `javascript:foo()` (rejected), `mailto:a@b`, `tel:+44`, `https://example.com` (all accepted).
- Verify focus outline no longer obscures cursor or H1 margin.
- Verify Backspace on a selected chip deletes it.

## Out of scope

- Migration of any existing content using the `cmsLink` mark or stock `Link` mark. None exists — `feat/richtext-references` is unmerged from any prod data, no fixtures or starter bundles use cmsLink, and this branch isn't pushed.
- Visual regression coverage (Chromatic / Percy / image snapshots).
- A `prose` plugin install. Hand-rolled typography stays.
- Storybook coverage of the cmsEmbed-existing / chip-click-to-edit interaction flows. Deferred — see follow-ups.
- New target/rel options beyond `_blank` and `nofollow`. The minimal set covers 95% of authoring needs without bloating the modal.
- Drag-and-drop reordering of chips. ProseMirror's stock atom-node behaviour suffices.
- A "convert chip to plain text" action. Editors can copy the displayed text manually.

## Follow-ups (separate GH issues to open after this PR)

1. **Storybook MSW + auto-import shim plumbing** — add MSW handler fixtures for `/api/content-entries` and `/api/content-types/options`, plus `unplugin-auto-import` shims for `useAuthedFetch` / `useRequestFetch` / `useToast` / `navigateTo`. Unlocks interaction-test stories for the rich text editor (chip-click-to-edit flows) and any other components currently blocked by Nuxt-only auto-imports. Reference back to #115.

## Migration of existing branch state

Already on the branch (commits `90d8a3d`, `795ffcc`, `5e64832`, `e466ad3`, `524b57e`):

- **Task 1 (story)**: kept; sample doc to be migrated to new node shapes during the chip work.
- **Task 2 (typography)**: kept entirely.
- **Task 3 (cmsLink underline + chain icon)**: reverted in this work; replaced by the chip styling under `.rich-text-editor__chip`.
- **Task 4 (toolbar colours)**:
  - `color="neutral"` on table button: kept.
  - `color="neutral"` on embed button: kept.
  - `:color="editor.isActive('link') ? 'primary' : 'neutral'"` on external link button: reverted to static `color="neutral"`.
  - `:color="editor?.isActive('cmsLink') ? 'primary' : 'neutral'"` on cmsLink button (pre-existing): reverted to static `color="neutral"`.
- **Task 5 (typography comment)**: kept.

The reverts happen as part of the chip-redesign tasks rather than as standalone revert commits — the line changes are absorbed into the new template/CSS shape.
