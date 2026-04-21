# Deeply-Nested Relation Editing (Pane-Within-Pane)

## Overview

Extend the stacked-pane entry editor to allow arbitrary depth. Clicking a RELATION or MULTIRELATION field inside an already-open `EntryEditorPane` should push a new pane onto the stack instead of silently no-op'ing (today's behaviour) or opening in a new tab (the pre-implementation plan). The URL stack, dirty-guard plumbing, and resolver cache are already depth-agnostic; the missing pieces are (1) rendering relation fields inside panes and (2) a shared orchestration contract that lets any pane reach the root router.

Tracks issue #36. Testing depends on #92 (Storybook 10 + Playwright infra) landing first.

## Scope

### In scope

- Render `RelationField` and `MultiRelationField` inside `EntryEditorPane` via a `#field` slot override.
- Introduce a `paneOrchestrator` provide/inject contract that exposes `openPane` and `openPicker` to every pane regardless of depth.
- Thread a `depth` prop into `EntryEditorPane` (the root editor is depth 0; each stacked pane is depth 1, 2, …).
- Move the "which field triggered this open" hint from the `?pf=` URL query param to an in-memory map keyed by target depth.
- Generalise `handlePaneSaved` so the save side-effect updates the parent pane (or the root) at any depth, not only at paneIdx 0.
- Expose `applyFieldUpdate(fieldKey, data)` on every `EntryEditorPane` via `defineExpose`.
- Lift the shared field-resolver state (`resolvedRelations`, `resolvedMultiRelations`, the resolver `watch`, `applyFieldUpdate`) into a new `useRelationFieldState` composable consumed by root and pane.

### Out of scope

- Entry deletion from within a pane at any depth — still tracked by #37.
- A hard depth cap or "new tab" escape hatch — nesting is uncapped; natural sliver UX self-regulates.
- Changes to `EntryPickerModal`, `RelationField`, `MultiRelationField`, `useRelationResolver`, `useContentEntryEditor`, or `paneStack.ts`.
- Server-side changes — none needed.
- Visual refinements to the stack (sliver colour / parallax / breadcrumb trail) — opportunistic follow-up if the UX falls down at depth.

## Architecture

### Pane orchestrator contract

The root page provides a small API via `provide('paneOrchestrator', ...)`:

```ts
type PaneOrchestrator = {
  openPicker: (
    fieldKey: string,
    targetContentTypeIds: string[],
    fromDepth: number
  ) => void;
  openPane: (
    contentTypeId: string,
    entryId: string | null,
    fieldKey: string,
    fromDepth: number
  ) => void;
};
```

- `fromDepth === 0` means the root editor triggered the call. `fromDepth ≥ 1` means `paneSegments[fromDepth - 1]` triggered it.
- The orchestrator always **truncates the stack to `fromDepth + 1`** before pushing the new segment or opening the picker. In practice only the topmost pane is interactive, but this makes the rule total and robust to edge cases (e.g. direct URL manipulation, mid-stack callers).

### Side-effect tracking

A component-scoped ref on the root page records "this pane was opened by clicking a relation card, and the triggering field key is X":

```ts
const pendingSideEffect = ref<Record<number, string>>({}); // depth → fieldKey
```

- Set when `openPane` is called (`pendingSideEffect[fromDepth + 1] = fieldKey`).
- Consumed in `handlePaneSaved(paneIdx, data)`: if `pendingSideEffect[paneIdx + 1]` is set, apply `applyFieldUpdate` to the parent (either `rootApplyFieldUpdate` when paneIdx is 0, or `paneEls[paneIdx - 1].applyFieldUpdate` otherwise), then clear the entry.
- Cleared for all depths `> newTopDepth` whenever the stack is truncated (via `closePane` or via `openPane`/`openPicker` truncation). Prevents stale side-effects from firing against a reused slot.
- Cold-loading a deep URL starts with an empty map — saves update only the entry's own record, which is correct.

### Replacing the `?pf` query param

The current `?pf=<fieldKey>` query param is dropped. It was only wired at depth 1 and did not survive reload cleanly. Pane-local in-memory tracking via `pendingSideEffect` is strictly simpler and composes at depth. No URL-level compatibility concern — `?pf` was only set by internal routing and never documented as an external API.

### URL stack

Unchanged. `paneStack.ts`'s `parseStack` / `encodeStack` / `stackHref` handle any depth today. `new:<contentTypeId>` sentinels remain valid at any depth and are rewritten in place by the existing `router.replace` in `handlePaneSaved`.

### Dirty guard

Unchanged. `anyPaneDirty(fromIdx)` already walks `paneEls` by index; `onBeforeRouteLeave`, `onBeforeRouteUpdate`, and `beforeunload` scale with stack depth without modification.

## Components

### `pages/entries/[...stack].vue` (root)

Changes:

- **Introduce `paneOrchestrator`:** replace the inline `openPane(ct, eid, fieldKey)` / `openPicker(fieldKey, targetIds)` with a single orchestrator object that takes an additional `fromDepth` argument. `provide('paneOrchestrator', orchestrator)`.
- **Use the orchestrator for root's own relation clicks:** the root editor's `#field` slot now calls `orchestrator.openPane(..., 0)` and `orchestrator.openPicker(..., 0)` instead of local functions. Same code path as any pane.
- **Add `pendingSideEffect` ref** (see Architecture).
- **Add a `rootApplyFieldUpdate(fieldKey, data)` helper** that writes into the root's `formState` — lifted from the existing `applyFieldUpdate` function by extracting it from the pane-only path.
- **Extend `handlePaneSaved(paneIdx, data)`** to read `pendingSideEffect` and dispatch to the right parent (see Architecture).
- **Drop `?pf` logic** from `handlePaneSaved`.
- **Loop `<EntryEditorPane v-for>`** passes `:depth="idx + 1"` to each pane.
- **Consume `useRelationFieldState`** (see below) for the root's own resolver state + `applyFieldUpdate`.

Unchanged: route guards, page-key definition, `useContentEntryEditor` wiring, `pageTitle`, slug auto-generation, `isDeleting` flag, delete handler (from #90).

### `components/entry-editor-pane/EntryEditorPane.vue`

Changes:

- **Accept `depth: number` prop** (required).
- **Inject the orchestrator:** `const orchestrator = inject('paneOrchestrator') as PaneOrchestrator`.
- **Add a `#field` slot on its internal `<ContentEditor>`** mirroring the root's: renders `RelationField` / `MultiRelationField`, wires their events to `orchestrator.openPicker(..., depth)` / `orchestrator.openPane(..., depth)`.
- **Consume `useRelationFieldState`** for `resolvedRelations`, `resolvedMultiRelations`, the resolver `watch`, and `applyFieldUpdate`.
- **Expose `applyFieldUpdate` via `defineExpose`** alongside the existing `isDirty`.
- **No `EntryPickerModal` rendered here** — the picker stays a single instance at the root.

Prop additions to `entryEditorPane.types.ts`:

```ts
export type EntryEditorPaneProps = BasicComponentProps & {
  open: boolean;
  contentTypeId?: string;
  entryId: string | null;
  depth: number;
};
```

### New: `composables/useRelationFieldState.ts`

Encapsulates the duplicated relation-field plumbing so the root and `EntryEditorPane` share one implementation.

```ts
type RelationRef = { contentTypeId: string; entryId: string };

export function useRelationFieldState(
  formState: Record<string, unknown>,
  editorFields: Ref<FieldConfig[]>
) {
  const { resolveRef, resolveRefs, updateCache } = useRelationResolver();

  const resolvedRelations = reactive<
    Record<string, { entryTitle: string; contentTypeName: string }>
  >({});
  const resolvedMultiRelations = reactive<
    Record<
      string,
      Array<RelationRef & { entryTitle: string; contentTypeName: string }>
    >
  >({});

  watch(
    () => ({ ...formState }),
    async () => {
      /* existing resolver logic, unchanged */
    },
    { immediate: true }
  );

  function getRelationValue(value: unknown): RelationRef | null {
    /* … */
  }
  function getMultiRelationValue(value: unknown): RelationRef[] {
    /* … */
  }
  function getTargetContentTypeIds(field: FieldConfig): string[] {
    /* … */
  }

  function applyFieldUpdate(fieldKey: string, data: RelationRef) {
    const field = editorFields.value.find((f) => f.key === fieldKey);
    if (!field) return;
    if (field.type === 'dynamic-relation') {
      formState[fieldKey] = {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      };
    } else if (field.type === 'dynamic-multirelation') {
      const current = (formState[fieldKey] as RelationRef[]) ?? [];
      if (!current.some((r) => r.entryId === data.entryId)) {
        formState[fieldKey] = [...current, data];
      }
    }
  }

  return {
    resolvedRelations,
    resolvedMultiRelations,
    getRelationValue,
    getMultiRelationValue,
    getTargetContentTypeIds,
    applyFieldUpdate,
    updateCache,
  };
}
```

Not a required part of the nesting fix, but extracting it prevents 80-odd lines of copy-paste into the pane.

## Data flow

### Opening a relation from depth D

```
user clicks relation card in pane at depth D
  ↓ emits edit / add
pane calls orchestrator.openPane(ct, eid, fieldKey, fromDepth = D)
  ↓
root:
  1. pendingSideEffect[D + 1] = fieldKey
  2. truncate pendingSideEffect for all depths > D + 1
  3. stack = parsedStack.slice(0, D + 1).concat(newSegment)
  4. router.push(stackHref(stack))
  ↓
Vue renders new pane at depth D + 1
```

### Opening the picker from depth D

```
user clicks "Add entry" in pane at depth D
  ↓
pane calls orchestrator.openPicker(fieldKey, targetIds, fromDepth = D)
  ↓
root:
  1. pickerFieldKey = fieldKey
  2. pickerTargetTypeIds = targetIds
  3. pickerFromDepth = D
  4. truncate stack to depth D + 1 (rare but normalises)
  5. pickerOpen = true
```

```
user selects existing entry
  ↓ picker emits select({ ct, eid, entryTitle })
root.handlePickerSelect:
  - if pickerFromDepth === 0: rootApplyFieldUpdate(fieldKey, { ct, eid })
  - else: paneEls[pickerFromDepth - 1].applyFieldUpdate(fieldKey, { ct, eid })
  - pickerOpen = false
```

```
user clicks "Create new …"
  ↓ picker emits create(ct)
root.handlePickerCreate(ct):
  - pickerOpen = false
  - orchestrator.openPane(ct, null, pickerFieldKey, pickerFromDepth)
    → follows the relation-open flow above, pushing new:<ct>
```

### Saving a pane at depth D (paneIdx = D − 1)

```
pane save completes
  ↓ emits saved({ ct, eid, entryTitle })
root.handlePaneSaved(paneIdx = D − 1, data):
  1. updateCache(ct, eid, entryTitle)
  2. fieldKey = pendingSideEffect[D]
     if fieldKey is set:
       parentDepth = D - 1
       if parentDepth === 0: rootApplyFieldUpdate(fieldKey, data)
       else: paneEls[parentDepth - 1].applyFieldUpdate(fieldKey, data)
       delete pendingSideEffect[D]
  3. if segment was new:<ct>, replace with entry:<eid> via router.replace
  4. pane stays mounted
```

### Closing a pane at depth D (paneIdx = D − 1)

```
user clicks sliver or back button of pane at depth D
  ↓
closePane(paneIdx = D − 1):
  1. newStack = parsedStack.slice(0, D)
  2. truncate pendingSideEffect for all depths ≥ D
  3. router.push(stackHref(newStack))
  ↓
onBeforeRouteUpdate fires:
  if anyPaneDirty(D - 1): window.confirm("You have unsaved changes. Close anyway?")
```

### Cold-load at deep URL

- `parseStack` reconstructs all segments; `paneEls` and `EntryEditorPane` instances mount at each depth and fetch independently.
- `pendingSideEffect` is empty on mount, so saves affect only the entry being edited — no accidental parent-formState mutations. (Behaviour improvement vs. the old `?pf` param which would have incorrectly re-applied on reload.)

## Edge cases

| Case                                                                  | Behaviour                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same entry open twice in the stack (reciprocal relation)              | Allowed. Page-key is `entries:${rootEntryId}`; pane instances are keyed by stack index. Separate `useContentEntryEditor` calls fetch independently. No dedup enforced.          |
| Picker closed without selecting                                       | `pendingSideEffect` was never written (only `openPane` writes it), so nothing to clean up.                                                                                      |
| "Create new …" chosen, new pane closed without saving                 | `pendingSideEffect[D+1]` was set on open. Closing trims to depth D and clears `pendingSideEffect` for depths ≥ D+1. Parent formState untouched, correct.                        |
| Save error inside a pane                                              | Unchanged. `useContentEntryEditor` surfaces into `saveError` and `fieldErrors`. `handlePaneSaved` only fires on success.                                                        |
| Deleting an entry while children are open                             | Out of scope (#37, #90). Delete button is only rendered in the root editor today.                                                                                               |
| Mid-stack caller (orchestrator invoked from `fromDepth < currentTop`) | Orchestrator always truncates to `fromDepth + 1` first. Any deeper panes are discarded; dirty-guard fires via `onBeforeRouteUpdate` and respects `anyPaneDirty(fromDepth + 1)`. |
| Relation reference points to a deleted entry                          | Out of scope — the resolver already tolerates a 404 by showing the reference ID and a broken-link indicator (existing behaviour). Nested panes don't change this.               |

## Testing

All interaction testing lives in Storybook 10 + Playwright (depends on #92 shipping first). No new Vitest integration or unit tests required. Server endpoints are unchanged.

### Storybook stories to add (consumers of the new infra from #92)

- **`EntryEditorPane/Nested.stories.ts`**
  - `play` function: open a relation card in a root-level entry, assert a pane appears; click a relation card inside that pane, assert a second pane appears; assert both panes are visible (stacked).
  - Uses MSW handlers for the content-type and content-entry endpoints; uses the authenticated decorator from #92.

- **`paneOrchestrator/SaveSideEffect.stories.ts`**
  - `play` function: open a new-entry pane from depth 2's relation picker, fill out the pane, click Save, assert the depth-2 pane's formState now contains the saved entry reference.
  - MSW handler for POST `/api/content-entries` returning a deterministic id.

- **`paneOrchestrator/DirtyGuard.stories.ts`**
  - `play` function: open two panes deep, type into the depth-2 pane to make it dirty, click the root sliver, assert a `window.confirm` was triggered once (Storybook `play` can stub `window.confirm` via a module mock).

### Smoke list (post-implementation, pre-PR)

Run by hand in dev as a quick gut check before opening the PR, not as a replacement for automated coverage:

- Three-deep stack renders and each pane is independently editable.
- Cold-load `/entries/a~b~c~d` from a fresh reload lands on a four-deep stack with no console errors.
- Saving a new entry at depth 3 propagates its id into the depth-2 MULTIRELATION array.

## Files touched

| File                                                             | Change                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/cms/pages/entries/[...stack].vue`                          | Introduce orchestrator, pendingSideEffect map, rootApplyFieldUpdate; drop `?pf`; pass depth to pane loop.                |
| `apps/cms/components/entry-editor-pane/EntryEditorPane.vue`      | Accept `depth` prop; inject orchestrator; add `#field` slot; consume `useRelationFieldState`; expose `applyFieldUpdate`. |
| `apps/cms/components/entry-editor-pane/entryEditorPane.types.ts` | Add `depth: number` to props type.                                                                                       |
| `apps/cms/composables/useRelationFieldState.ts`                  | **New.** Shared resolver + applyFieldUpdate state.                                                                       |
| `apps/cms/.storybook/stories/EntryEditorPane/*.stories.ts`       | **New.** Interaction tests per Testing section (depends on #92).                                                         |

## Open questions

None at time of writing. Revisit if the sliver UX breaks down at depth ≥ 6 during manual smoke — a breadcrumb or stack-collapse affordance would then become a follow-up.

## Related

- Blocked by #92 (Storybook + Playwright infra) for the testing story.
- Supersedes the "Deep nesting out of scope" note in `docs/superpowers/specs/2026-04-13-relation-entry-editor-design.md`.
- Does not affect #37 (delete-from-pane) or #64 (pane a11y) — those remain independent.
