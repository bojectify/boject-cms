# Deeply-Nested Relation Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #36: let users open a relation field inside an `EntryEditorPane` and push a new pane onto the stack, at any depth, with save-side-effects plumbed back to the originating pane's formState.

**Architecture:** Extract the root editor's relation plumbing into a `useRelationFieldState` composable shared by root and pane. Introduce a `paneOrchestrator` contract via `provide`/`inject` so root and pane use the same code path for `openPane` / `openPicker`, with each caller passing its `depth`. Replace the `?pf` query param with an in-memory `pendingSideEffect` map keyed by target depth. Each `EntryEditorPane` exposes `applyFieldUpdate` via `defineExpose`, and the root's `handlePaneSaved` walks `paneEls` by depth to invoke it.

**Tech Stack:** Vue 3 composition API, Nuxt 4 pages/components, Storybook 10 + Vitest browser mode for interaction tests (#92 infra).

**Prerequisite:** #92 merged (Storybook 10 + `@storybook/addon-vitest` + MSW). This plan includes adding Nuxt auto-import shims so stories can render `EntryEditorPane`, which #92 deferred.

---

## File Structure

**New files:**

- `apps/cms/composables/useRelationFieldState.ts` — shared relation resolver + `applyFieldUpdate`.
- `apps/cms/composables/paneOrchestrator.ts` — typed injection key + `PaneOrchestrator` interface.
- `apps/cms/.storybook/shims/nuxt-autoimports.ts` — Storybook-only stubs for `useAuthedFetch`, `useFetch`, `useRequestHeaders`, `navigateTo`, `useToast`.
- `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts` — interaction tests for the pane-within-pane flow.

**Modified files:**

- `apps/cms/pages/entries/[...stack].vue` — consume `useRelationFieldState`, provide `paneOrchestrator`, generalize `handlePaneSaved`, drop `?pf` query param, pass `depth` to panes.
- `apps/cms/components/entry-editor-pane/EntryEditorPane.vue` — accept `depth` prop, inject `paneOrchestrator`, render `#field` slot, consume `useRelationFieldState`, expose `applyFieldUpdate`.
- `apps/cms/components/entry-editor-pane/entryEditorPane.types.ts` — add `depth: number` to props.
- `apps/cms/.storybook/main.ts` — extend Nuxt UI's `unplugin-auto-import` with a `dirs` entry pointing at the shims + install `ofetch`.
- `apps/cms/package.json` — add `ofetch` as a direct devDep (used by the shim for `$fetch`).

---

## Phase 1 — Shared relation plumbing (no behaviour change)

### Task 1: Extract `useRelationFieldState` composable

**Files:**

- Create: `apps/cms/composables/useRelationFieldState.ts`

The composable owns the relation resolver state and the `applyFieldUpdate` helper currently inlined in the root page. Keep the return shape identical to what the page uses.

- [ ] **Step 1: Write the composable**

Create `apps/cms/composables/useRelationFieldState.ts`:

```ts
import { reactive, watch, type Ref } from 'vue';
import type { FieldConfig } from '~/types/contentEditor';

type RelationRef = { contentTypeId: string; entryId: string };

type ResolvedRelation = { entryTitle: string; contentTypeName: string };
type ResolvedMultiRelation = RelationRef & {
  entryTitle: string;
  contentTypeName: string;
};

export function useRelationFieldState(
  formState: Record<string, unknown>,
  editorFields: Ref<FieldConfig[]>
) {
  const { resolveRef, resolveRefs, updateCache } = useRelationResolver();

  const resolvedRelations = reactive<Record<string, ResolvedRelation>>({});
  const resolvedMultiRelations = reactive<
    Record<string, ResolvedMultiRelation[]>
  >({});

  watch(
    () => ({ ...formState }),
    async () => {
      for (const field of editorFields.value) {
        if (field.type === 'dynamic-relation') {
          const val = formState[field.key] as RelationRef | null;
          if (val?.contentTypeId && val?.entryId) {
            const resolved = await resolveRef(val);
            resolvedRelations[field.key] = {
              entryTitle: resolved.entryTitle,
              contentTypeName: resolved.contentTypeName,
            };
          } else {
            Reflect.deleteProperty(resolvedRelations, field.key);
          }
        }
        if (field.type === 'dynamic-multirelation') {
          const val = formState[field.key] as RelationRef[] | null;
          if (val && val.length > 0) {
            resolvedMultiRelations[field.key] = await resolveRefs(val);
          } else {
            resolvedMultiRelations[field.key] = [];
          }
        }
      }
    },
    { immediate: true }
  );

  function getRelationValue(value: unknown): RelationRef | null {
    return (value as RelationRef | null) ?? null;
  }

  function getMultiRelationValue(value: unknown): RelationRef[] {
    return (value as RelationRef[]) ?? [];
  }

  function getTargetContentTypeIds(field: FieldConfig): string[] {
    if (
      field.type === 'dynamic-relation' ||
      field.type === 'dynamic-multirelation'
    ) {
      return field.targetContentTypeIds;
    }
    return [];
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
      const current = (formState[fieldKey] as RelationRef[] | undefined) ?? [];
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

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/composables/useRelationFieldState.ts
git commit -m "refactor: extract useRelationFieldState composable"
```

### Task 2: Root page consumes `useRelationFieldState`

**Files:**

- Modify: `apps/cms/pages/entries/[...stack].vue:283-413`

Replace the inline `RelationRef` type, resolver `watch`, and `applyFieldUpdate` with the composable. The rest of the file (pane loop, `handlePaneSaved`, etc.) is unchanged in this task.

- [ ] **Step 1: Replace the inline code**

In `apps/cms/pages/entries/[...stack].vue`, delete lines 283–365 (the `// ---- Template helpers ----` block through the end of the `watch(() => ({ ...formState }), ...)` block) and replace with:

```ts
// ---- Relation field state (resolvers + applyFieldUpdate) ----
const {
  resolvedRelations,
  resolvedMultiRelations,
  getRelationValue,
  getMultiRelationValue,
  getTargetContentTypeIds,
  applyFieldUpdate: rootApplyFieldUpdate,
  updateCache,
} = useRelationFieldState(formState, editorFields);
```

Also delete the existing local `applyFieldUpdate` function (lines ~389–413) and rewire any callers (`handlePickerSelect`, `handlePaneSaved`) to use `rootApplyFieldUpdate`.

- [ ] **Step 2: Typecheck + run existing interaction tests**

```bash
pnpm typecheck
pnpm --filter cms test:storybook
```

Expected: typecheck clean, 4/4 Storybook tests still pass.

- [ ] **Step 3: Manual smoke in dev**

```bash
pnpm dev
```

Navigate to an entry with a RELATION field. Verify:

- The field renders with the resolved title (i.e. resolver still working).
- Clicking "Add entry" opens the picker.
- Selecting an entry fills the field.

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/pages/entries/[...stack].vue
git commit -m "refactor: consume useRelationFieldState in root entry page"
```

---

## Phase 2 — Orchestrator contract

### Task 3: Add `paneOrchestrator` injection key + type

**Files:**

- Create: `apps/cms/composables/paneOrchestrator.ts`

- [ ] **Step 1: Write the file**

Create `apps/cms/composables/paneOrchestrator.ts`:

```ts
import type { InjectionKey } from 'vue';

export type PaneOrchestrator = {
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

export const paneOrchestratorKey: InjectionKey<PaneOrchestrator> =
  Symbol('paneOrchestrator');
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/cms/composables/paneOrchestrator.ts
git commit -m "feat: add paneOrchestrator injection contract"
```

### Task 4: Provide orchestrator from root + add `pendingSideEffect` + generalize `handlePaneSaved`

**Files:**

- Modify: `apps/cms/pages/entries/[...stack].vue`

This is the meatiest task. It:

1. Introduces `pendingSideEffect` (`ref<Record<number, string>>`).
2. Rewrites `openPane` and `openPicker` into an orchestrator that takes `fromDepth`, truncates the stack to `fromDepth + 1`, clears deeper `pendingSideEffect` entries, then pushes / opens.
3. Drops the `?pf=` URL param (no more `route.query.pf`, no more `openPane(..., fieldKey)` appending `?pf`).
4. Rewrites `handlePaneSaved` to look up `pendingSideEffect[paneIdx + 1]` and dispatch to the parent (root via `rootApplyFieldUpdate` or pane via `paneEls[paneIdx - 1]?.applyFieldUpdate`).
5. Provides the orchestrator via `provide(paneOrchestratorKey, orchestrator)`.
6. Rewrites the root's own `#field` slot calls to go through the orchestrator with `fromDepth: 0`.
7. Rewrites `handlePickerSelect` / `handlePickerCreate` to dispatch via the pending-depth and orchestrator respectively.

- [ ] **Step 1: Add imports and state**

Near the existing imports in the `<script setup>` block:

```ts
import { provide, ref } from 'vue';
import {
  paneOrchestratorKey,
  type PaneOrchestrator,
} from '~/composables/paneOrchestrator';
```

Below the `useRelationFieldState` call (added in Task 2):

```ts
// Tracks which fieldKey to apply the side-effect to when the pane at a
// given depth next saves. Keyed by target depth (root is 0).
const pendingSideEffect = ref<Record<number, string>>({});

// Track which depth currently owns the open picker.
const pickerFromDepth = ref(0);
```

- [ ] **Step 2: Replace the openPicker / openPane / handlePickerSelect / handlePickerCreate block**

Locate the `// ---- Picker modal state ----` block and the later `// ---- Pane navigation ----` block. Replace them with:

```ts
// ---- Picker modal state ----
const pickerOpen = ref(false);
const pickerFieldKey = ref('');
const pickerTargetTypeIds = ref<string[]>([]);

// ---- Orchestrator ----
function truncateDeeperSideEffects(newTopDepth: number) {
  const next: Record<number, string> = {};
  for (const [depth, fieldKey] of Object.entries(pendingSideEffect.value)) {
    if (Number(depth) <= newTopDepth) next[Number(depth)] = fieldKey;
  }
  pendingSideEffect.value = next;
}

const orchestrator: PaneOrchestrator = {
  openPicker(fieldKey, targetContentTypeIds, fromDepth) {
    // Truncate any deeper panes before showing the picker.
    const newStack = parsedStack.value.slice(0, fromDepth + 1);
    if (newStack.length !== parsedStack.value.length) {
      router.push(stackHref(newStack));
    }
    truncateDeeperSideEffects(fromDepth);
    pickerFieldKey.value = fieldKey;
    pickerTargetTypeIds.value = targetContentTypeIds;
    pickerFromDepth.value = fromDepth;
    pickerOpen.value = true;
  },
  openPane(contentTypeId, entryId, fieldKey, fromDepth) {
    const targetDepth = fromDepth + 1;
    pendingSideEffect.value = {
      ...pendingSideEffect.value,
      [targetDepth]: fieldKey,
    };
    const newSegment = entryId
      ? { kind: 'entry' as const, entryId }
      : { kind: 'new' as const, contentTypeId };
    const newStack = parsedStack.value.slice(0, fromDepth + 1);
    newStack.push(newSegment);
    router.push(stackHref(newStack));
  },
};

provide(paneOrchestratorKey, orchestrator);

function handlePickerSelect(data: {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
}) {
  const fieldKey = pickerFieldKey.value;
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);
  if (pickerFromDepth.value === 0) {
    rootApplyFieldUpdate(fieldKey, {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    });
  } else {
    paneEls.value?.[pickerFromDepth.value - 1]?.applyFieldUpdate(fieldKey, {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    });
  }
  pickerOpen.value = false;
}

function handlePickerCreate(ctId: string) {
  const fieldKey = pickerFieldKey.value;
  const fromDepth = pickerFromDepth.value;
  pickerOpen.value = false;
  orchestrator.openPane(ctId, null, fieldKey, fromDepth);
}

function handleRelationEdit(value: unknown, fieldKey: string) {
  const ref = value as { contentTypeId: string; entryId: string } | null;
  if (ref) {
    orchestrator.openPane(ref.contentTypeId, ref.entryId, fieldKey, 0);
  }
}
```

- [ ] **Step 3: Rewrite `handlePaneSaved`**

Locate the existing `function handlePaneSaved(paneIdx: number, data: ...)` and replace with:

```ts
function handlePaneSaved(
  paneIdx: number,
  data: { contentTypeId: string; entryId: string; entryTitle: string }
) {
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);

  // Apply the pending side-effect (if any) to the parent pane at depth
  // paneIdx (which is targetDepth - 1 relative to this save).
  const targetDepth = paneIdx + 1;
  const fieldKey = pendingSideEffect.value[targetDepth];
  if (fieldKey) {
    if (paneIdx === 0) {
      rootApplyFieldUpdate(fieldKey, {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      });
    } else {
      paneEls.value?.[paneIdx - 1]?.applyFieldUpdate(fieldKey, {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      });
    }
    const next = { ...pendingSideEffect.value };
    delete next[targetDepth];
    pendingSideEffect.value = next;
  }

  // Rewrite new:<ct> sentinel to the saved entry id (unchanged).
  const fullStackIdx = paneIdx + 1;
  const currentSegment = parsedStack.value[fullStackIdx];
  if (!currentSegment) return;
  const replacedSegment: PaneSegment =
    currentSegment.kind === 'new'
      ? { kind: 'entry', entryId: data.entryId }
      : currentSegment;
  const newStack = [...parsedStack.value];
  newStack[fullStackIdx] = replacedSegment;
  router.replace(stackHref(newStack));
}
```

- [ ] **Step 4: Rewrite `closePane` to clear deeper side-effects**

Replace `closePane`:

```ts
function closePane(idx: number) {
  const newStack = parsedStack.value.slice(0, idx + 1);
  truncateDeeperSideEffects(idx);
  router.push(stackHref(newStack));
}
```

- [ ] **Step 5: Remove the `?pf` query param usage**

Search the file for `route.query.pf` and `?pf=` / `pf:` and ensure all references are gone. The old `handlePaneSaved` read `route.query.pf` — that logic is replaced by `pendingSideEffect`. The old `openPane` pushed `{ path: stackHref(...), query: { pf: fieldKey } }` — now it uses `router.push(stackHref(...))` without query.

- [ ] **Step 6: Update the `<EntryPickerModal>` template binding**

The `target-content-type-ids` prop still binds `pickerTargetTypeIds`. The `@select` / `@create` / `@close` handlers are the new `handlePickerSelect` / `handlePickerCreate` / picker-close. No template change expected beyond confirming the handler names match.

- [ ] **Step 7: Update the root's `#field` slot**

In the template, inside the `<ContentEditor>` `#field` slot, change:

```vue
@add="openPicker(field.key, getTargetContentTypeIds(field))"
@edit="handleRelationEdit(value, field.key)"
```

to:

```vue
@add=" orchestrator.openPicker(field.key, getTargetContentTypeIds(field), 0) "
@edit="handleRelationEdit(value, field.key)"
```

(`handleRelationEdit` already calls `orchestrator.openPane(..., 0)` from Step 2.)

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. If `PaneSegment` import is missing, add: `import type { PaneSegment } from '~/utils/paneStack';`

- [ ] **Step 9: Manual smoke in dev**

```bash
pnpm dev
```

Regression check on the root editor — nothing user-visible should have changed at depth 0 yet:

- Open a root entry with a relation. Click "Add entry", pick one → card fills in.
- Click the relation card → pane opens. Save the pane → card updates with the saved title.
- Close the pane without saving → no change to the root.

Kill the dev server.

- [ ] **Step 10: Commit**

```bash
git add apps/cms/pages/entries/[...stack].vue
git commit -m "feat: introduce paneOrchestrator + pendingSideEffect map"
```

---

## Phase 3 — Pane plumbing

### Task 5: Add `depth` prop to `EntryEditorPane`

**Files:**

- Modify: `apps/cms/components/entry-editor-pane/entryEditorPane.types.ts`
- Modify: `apps/cms/components/entry-editor-pane/EntryEditorPane.vue`
- Modify: `apps/cms/pages/entries/[...stack].vue`

- [ ] **Step 1: Add `depth` to props type**

Edit `apps/cms/components/entry-editor-pane/entryEditorPane.types.ts`. Add `depth: number` to `EntryEditorPaneProps`:

```ts
export type EntryEditorPaneProps = BasicComponentProps & {
  open: boolean;
  contentTypeId?: string;
  entryId: string | null;
  depth: number;
};
```

- [ ] **Step 2: Pass `depth` from the root v-for**

In `apps/cms/pages/entries/[...stack].vue`, update the `<EntryEditorPane v-for>` to include `:depth="idx + 1"`:

```vue
<EntryEditorPane
  v-for="(pane, idx) in paneSegments"
  :key="`pane-${idx}`"
  ref="paneEls"
  :open="true"
  :depth="idx + 1"
  :content-type-id="pane.kind === 'new' ? pane.contentTypeId : undefined"
  :entry-id="pane.kind === 'entry' ? pane.entryId : null"
  @close="closePane(idx)"
  @saved="(data) => handlePaneSaved(idx, data)"
/>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: still clean (pane currently ignores the new prop).

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/entry-editor-pane/entryEditorPane.types.ts apps/cms/pages/entries/[...stack].vue
git commit -m "feat(pane): accept depth prop from root v-for"
```

### Task 6: Inject orchestrator, render `#field` slot, consume `useRelationFieldState`, expose `applyFieldUpdate`

**Files:**

- Modify: `apps/cms/components/entry-editor-pane/EntryEditorPane.vue`

- [ ] **Step 1: Add imports + injection + state**

In `<script setup>`, near the top:

```ts
import { computed, inject, onMounted, reactive, watch } from 'vue';
import type { FieldConfig } from '~/types/contentEditor';
import type { EntryEditorPaneProps } from './entryEditorPane.types';
import { QA_ENTRY_EDITOR_PANE } from './entryEditorPane.config';
import { paneOrchestratorKey } from '~/composables/paneOrchestrator';

const props = withDefaults(defineProps<EntryEditorPaneProps>(), {
  testId: QA_ENTRY_EDITOR_PANE.COMPONENT,
});

const orchestrator = inject(paneOrchestratorKey);
if (!orchestrator) {
  throw new Error(
    'EntryEditorPane requires a paneOrchestrator provided by its ancestor.'
  );
}
```

(The `inject` throw is deliberate — catches a bug where the pane is used outside the stack editor.)

- [ ] **Step 2: Replace the inline relation plumbing with the composable**

After the existing `useContentEntryEditor` call + content-type derivation, add:

```ts
const {
  resolvedRelations,
  resolvedMultiRelations,
  getRelationValue,
  getMultiRelationValue,
  getTargetContentTypeIds,
  applyFieldUpdate,
} = useRelationFieldState(formState, editorFields);
```

(`useRelationFieldState` auto-imports from `apps/cms/composables/`.)

- [ ] **Step 3: Expose `applyFieldUpdate` and `isDirty`**

Replace the existing `defineExpose`:

```ts
defineExpose({ isDirty, applyFieldUpdate });
```

- [ ] **Step 4: Render the `#field` slot in the template**

Inside the `<ContentEditor>` tag, replace the self-closing tag with the slot content (mirroring root):

```vue
<ContentEditor
  ref="editorRef"
  v-model:state="formState"
  :title="pageTitle"
  :fields="editorFields"
  :loading="loadingStatus === 'pending'"
  :error="saveError"
  :field-errors="fieldErrors"
>
  <template #field="{ field, value, update }">
    <RelationField
      v-if="field.type === 'dynamic-relation'"
      :label="field.label"
      :required="field.required"
      :value="getRelationValue(value)"
      :entry-title="resolvedRelations[field.key]?.entryTitle ?? null"
      :content-type-name="
        resolvedRelations[field.key]?.contentTypeName ?? null
      "
      @add="
        orchestrator.openPicker(
          field.key,
          getTargetContentTypeIds(field),
          props.depth
        )
      "
      @edit="
        (() => {
          const ref = getRelationValue(value);
          if (ref)
            orchestrator.openPane(
              ref.contentTypeId,
              ref.entryId,
              field.key,
              props.depth
            );
        })()
      "
      @remove="update(null)"
    />
    <MultiRelationField
      v-else-if="field.type === 'dynamic-multirelation'"
      :label="field.label"
      :items="resolvedMultiRelations[field.key] ?? []"
      @add="
        orchestrator.openPicker(
          field.key,
          getTargetContentTypeIds(field),
          props.depth
        )
      "
      @edit="
        (idx) => {
          const refs = getMultiRelationValue(value);
          const r = refs[idx];
          if (r) {
            orchestrator.openPane(
              r.contentTypeId,
              r.entryId,
              field.key,
              props.depth
            );
          }
        }
      "
      @remove="
        (idx) => {
          const refs = [...getMultiRelationValue(value)];
          refs.splice(idx, 1);
          update(refs);
        }
      "
      @reorder="(items) => update(items)"
    />
  </template>
</ContentEditor>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Manual smoke in dev — three-deep edit**

```bash
pnpm dev
```

Manual test:

1. Open a root entry with a RELATION field.
2. Click the relation card → pane at depth 1 opens.
3. Inside the depth-1 pane, click a RELATION field → pane at depth 2 opens.
4. Edit, save depth-2 → depth-1's card updates with the new title.
5. Close depth-2 → depth-1 still open.
6. Click a MULTIRELATION in depth-1 → pane at depth 2 opens. Create a new entry, save → depth-1's multirelation array gains the new item.
7. Close depth-1 → back to root with all applied edits (unsaved at root).

If any step fails, fix before committing. Don't move on.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/components/entry-editor-pane/EntryEditorPane.vue
git commit -m "feat(pane): render relation fields + expose applyFieldUpdate at any depth"
```

---

## Phase 4 — Storybook auto-import shims for Nuxt composables

### Task 7: Install `ofetch` and scaffold the shims file

**Files:**

- Create: `apps/cms/.storybook/shims/nuxt-autoimports.ts`
- Modify: `apps/cms/package.json` (via pnpm)

- [ ] **Step 1: Install ofetch**

```bash
pnpm --filter cms add -D ofetch
```

- [ ] **Step 2: Write the shim file**

Create `apps/cms/.storybook/shims/nuxt-autoimports.ts`:

```ts
import { ref, type Ref } from 'vue';
import { $fetch as ofetchFn } from 'ofetch';

// Minimal Storybook-only shims for the Nuxt auto-imported helpers our
// components use. Real Nuxt composables live in the Nuxt runtime, which
// isn't loaded in the Storybook Vite bundle.

export const $fetch = ofetchFn;

export function useRequestHeaders(): Record<string, string> {
  return {};
}

export function useRequestFetch() {
  return ofetchFn;
}

export function useFetch<T = unknown>(
  url: string | (() => string | null),
  options?: Parameters<typeof ofetchFn>[1]
): {
  data: Ref<T | null>;
  pending: Ref<boolean>;
  error: Ref<Error | null>;
  status: Ref<'idle' | 'pending' | 'success' | 'error'>;
  refresh: () => Promise<void>;
  execute: () => Promise<void>;
} {
  const data = ref<T | null>(null) as Ref<T | null>;
  const pending = ref(true);
  const error = ref<Error | null>(null);
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('pending');

  const resolveUrl = typeof url === 'function' ? url() : url;
  if (resolveUrl == null) {
    pending.value = false;
    status.value = 'idle';
  } else {
    ofetchFn<T>(resolveUrl, options)
      .then((res) => {
        data.value = res;
        status.value = 'success';
      })
      .catch((err: Error) => {
        error.value = err;
        status.value = 'error';
      })
      .finally(() => {
        pending.value = false;
      });
  }

  return {
    data,
    pending,
    error,
    status,
    refresh: async () => {},
    execute: async () => {},
  };
}

// Minimal Nuxt UI toast shim. Captured to window so play functions can
// assert on toast output.
type Toast = { title?: string; description?: string; color?: string };

declare global {
  interface Window {
    __storybook_toasts__: Toast[];
  }
}

if (typeof window !== 'undefined') {
  window.__storybook_toasts__ = [];
}

export function useToast() {
  return {
    add: (toast: Toast) => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__.push(toast);
      }
    },
    remove: () => {},
    clear: () => {
      if (typeof window !== 'undefined') {
        window.__storybook_toasts__ = [];
      }
    },
  };
}

// Stub navigation — we never actually navigate in Storybook.
export async function navigateTo() {}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/cms/.storybook/shims/nuxt-autoimports.ts apps/cms/package.json pnpm-lock.yaml
git commit -m "chore(storybook): add nuxt-autoimports shim for \$fetch, useFetch, useToast, navigateTo"
```

### Task 8: Wire shims into Nuxt UI's auto-import

**Files:**

- Modify: `apps/cms/.storybook/main.ts`

- [ ] **Step 1: Extend `autoImport.dirs`**

Change the `ui({...})` block's `autoImport` option:

```ts
ui({
  autoImport: {
    imports: ['vue'],
    dirs: [
      fileURLToPath(new URL('./shims', import.meta.url)),
      fileURLToPath(new URL('../composables', import.meta.url)),
    ],
  },
});
```

- [ ] **Step 2: Run existing tests to catch regressions**

```bash
pnpm --filter cms test:storybook
```

Expected: the existing 4 stories still pass. If dep re-optimize fires once, rerun.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/.storybook/main.ts
git commit -m "chore(storybook): auto-import shims + project composables"
```

### Task 9: Writing a sanity-check story that uses the shims

**Files:**

- Create: `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`

This is a minimal "does it render" story, not an interaction test — that's Task 11.

- [ ] **Step 1: Write a stub story**

Create `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { http, HttpResponse } from 'msw';
import { h, provide } from 'vue';
import { paneOrchestratorKey } from '~/composables/paneOrchestrator';
import EntryEditorPane from './EntryEditorPane.vue';

const fakeOrchestrator = {
  openPicker: () => {},
  openPane: () => {},
};

const meta: Meta<typeof EntryEditorPane> = {
  title: 'Components/EntryEditorPane',
  component: EntryEditorPane,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      setup() {
        provide(paneOrchestratorKey, fakeOrchestrator);
        return () => h(story());
      },
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/content-entries/:id', ({ params }) =>
          HttpResponse.json({
            id: params.id,
            contentTypeId: 'ct-author',
            contentType: {
              id: 'ct-author',
              name: 'Author',
              identifier: 'Author',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: 'ENTRY_TITLE',
                  required: true,
                  options: null,
                },
              ],
            },
            status: 'DRAFT',
            data: { title: 'Ada Lovelace' },
            publishedAt: null,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            hasPublishedVersion: false,
          })
        ),
      ],
    },
  },
};

export default meta;

type Story = StoryObj<typeof EntryEditorPane>;

export const EditExisting: Story = {
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
};
```

- [ ] **Step 2: Run the story in Storybook dev**

```bash
pnpm --filter cms storybook
```

Open `http://localhost:6006`, navigate to `Components → EntryEditorPane → EditExisting`. The pane should render with the title input populated ("Ada Lovelace"). If it fails with `useAuthedFetch is not defined` or similar, revisit the shims — likely a missing re-export.

Kill storybook once verified.

- [ ] **Step 3: Run the test-runner**

```bash
pnpm --filter cms test:storybook
```

Expected: 5 tests pass (2 RelationField + 2 MultiRelationField + 1 EditExisting — the last without a play function just verifies it renders without throwing).

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts
git commit -m "test(storybook): EntryEditorPane renders with shimmed auto-imports"
```

---

## Phase 5 — Interaction stories for the nesting flow

### Task 10: Add a "nested open" interaction story

**Files:**

- Modify: `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`

This story uses a spy orchestrator and asserts that clicking a relation in the pane triggers `openPane` with the right depth. It does NOT render a real parent — it simulates what would happen.

- [ ] **Step 1: Add the story**

Append to `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`:

```ts
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

export const OpensRelationAtDepth: Story = {
  decorators: [
    (story) => ({
      setup() {
        const orchestrator = {
          openPicker: fn(),
          openPane: fn(),
        };
        provide(paneOrchestratorKey, orchestrator);
        (window as unknown as { __orch__: typeof orchestrator }).__orch__ =
          orchestrator;
        return () => h(story());
      },
    }),
  ],
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/content-entries/:id', ({ params }) =>
          HttpResponse.json({
            id: params.id,
            contentTypeId: 'ct-article',
            contentType: {
              id: 'ct-article',
              name: 'Article',
              identifier: 'Article',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: 'ENTRY_TITLE',
                  required: true,
                  options: null,
                },
                {
                  identifier: 'author',
                  name: 'Author',
                  type: 'RELATION',
                  required: false,
                  options: { targetContentTypeIds: ['ct-author'] },
                },
              ],
            },
            status: 'DRAFT',
            data: {
              title: 'Intro to Vue',
              author: { contentTypeId: 'ct-author', entryId: 'a1' },
            },
            publishedAt: null,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            hasPublishedVersion: false,
          })
        ),
        http.get('/api/content-entries/a1', () =>
          HttpResponse.json({
            id: 'a1',
            entryTitle: 'Ada Lovelace',
            contentType: { name: 'Author' },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const authorCard = await waitFor(() => screen.getByText('Ada Lovelace'), {
      timeout: 3000,
    });
    await userEvent.click(authorCard);
    const orch = (
      window as unknown as { __orch__: { openPane: ReturnType<typeof fn> } }
    ).__orch__;
    expect(orch.openPane).toHaveBeenCalledWith('ct-author', 'a1', 'author', 1);
  },
};
```

- [ ] **Step 2: Run the test-runner**

```bash
pnpm --filter cms test:storybook
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts
git commit -m "test(storybook): assert clicking a relation at depth calls orchestrator.openPane"
```

### Task 11: Add a "save propagates side-effect" interaction story

**Files:**

- Modify: `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`

This story mounts a pane at `depth: 2` with `entryId: null` (so it's a "new" entry), fills the title, clicks Save, and asserts the pane's `saved` event fires with the right payload. A spy orchestrator captures the signal.

- [ ] **Step 1: Add the story**

Append to `apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts`:

```ts
export const EmitsSavedOnPublish: Story = {
  render: (args) => ({
    components: { EntryEditorPane },
    setup() {
      const saved = fn();
      (window as unknown as { __saved__: ReturnType<typeof fn> }).__saved__ =
        saved;
      return () =>
        h(EntryEditorPane, {
          ...args,
          onSaved: saved,
        });
    },
  }),
  decorators: [
    (story) => ({
      setup() {
        provide(paneOrchestratorKey, { openPicker: fn(), openPane: fn() });
        return () => h(story());
      },
    }),
  ],
  args: {
    open: true,
    entryId: null,
    contentTypeId: 'ct-tag',
    depth: 2,
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/content-types/ct-tag', () =>
          HttpResponse.json({
            id: 'ct-tag',
            name: 'Tag',
            identifier: 'Tag',
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                options: null,
              },
            ],
          })
        ),
        http.post('/api/content-entries', () =>
          HttpResponse.json({
            id: 'new-tag-1',
            contentTypeId: 'ct-tag',
            status: 'DRAFT',
            data: { title: 'TypeScript' },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const titleInput = await waitFor(() => screen.getByLabelText(/title/i), {
      timeout: 3000,
    });
    await userEvent.type(titleInput, 'TypeScript');
    const saveBtn = screen.getByRole('button', { name: /save draft/i });
    await userEvent.click(saveBtn);

    const saved = (window as unknown as { __saved__: ReturnType<typeof fn> })
      .__saved__;
    await waitFor(() => expect(saved).toHaveBeenCalled(), { timeout: 3000 });
    expect(saved).toHaveBeenCalledWith({
      contentTypeId: 'ct-tag',
      entryId: 'new-tag-1',
      entryTitle: 'TypeScript',
    });
  },
};
```

- [ ] **Step 2: Run**

```bash
pnpm --filter cms test:storybook
```

Expected: 7 tests pass.

- [ ] **Step 3: Debugging tips if the save fails**

- If `getByLabelText(/title/i)` doesn't find the input, the form field may use a different accessible label. Use `getByPlaceholderText(/title/i)` or a more specific selector.
- If the save button label differs in this state, try `/publish/i` or check what `EntrySidebar.vue` actually renders.
- If `onSaved` never fires, `useContentEntryEditor`'s `saveDraft()` may be hitting a real fetch — verify MSW intercepts the POST.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/entry-editor-pane/EntryEditorPane.stories.ts
git commit -m "test(storybook): pane emits saved with the right payload after publish"
```

---

## Phase 6 — Finalization

### Task 12: Final verify + PR

- [ ] **Step 1: Run everything**

```bash
pnpm test
pnpm --filter cms test:storybook
pnpm lint
pnpm typecheck
pnpm format
```

All green.

- [ ] **Step 2: Manual smoke in dev one more time**

```bash
pnpm dev
```

Three-deep stack + save propagation + cold-reload at deep URL. If anything regresses, fix before opening the PR.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/36-deeply-nested-relations
```

Then:

```bash
gh pr create --title "feat: deeply-nested relation editing (#36)" --body "..."
```

PR body should list:

- Architecture (orchestrator contract + pendingSideEffect + useRelationFieldState)
- `?pf` query param dropped (behavioural improvement at reload)
- Nuxt auto-import shim infrastructure added for Storybook (was deferred from #92)
- Three new stories: EditExisting, OpensRelationAtDepth, EmitsSavedOnPublish
- Closes #36

---

## Self-review notes

**Spec coverage:**

- Pane orchestrator contract → Tasks 3 + 4 ✓
- `pendingSideEffect` map → Task 4 ✓
- Drop `?pf` URL param → Task 4 Step 5 ✓
- `depth` prop on `EntryEditorPane` → Task 5 ✓
- `#field` slot override inside pane → Task 6 Step 4 ✓
- Expose `applyFieldUpdate` via `defineExpose` → Task 6 Step 3 ✓
- Generalize `handlePaneSaved` → Task 4 Step 3 ✓
- `useRelationFieldState` composable → Task 1 ✓, consumed by root in Task 2, by pane in Task 6 ✓
- Testing via Storybook interaction tests (spec mandate) → Tasks 9 / 10 / 11 ✓
- Nuxt auto-import shim gap from #92 → Tasks 7 / 8 ✓

**Edge cases from the spec:**

- Same entry open twice in stack — no code change needed (URL stack handles it).
- Picker closed without selecting — nothing to clean up.
- Create-new then close without saving — Task 4's `closePane` clears `pendingSideEffect` for depths ≥ idx+1 ✓.
- Save error — unchanged path, Task 6's wiring doesn't affect error handling.
- Deleting mid-stack — out of scope (#37, #90).
- Mid-stack caller — Task 4 Step 2's truncate-then-push handles it.

**Placeholder scan:** No `TBD` / `TODO` / vague "handle edge cases" language. All code blocks are complete. All paths are absolute.

**Type consistency:**

- `PaneOrchestrator` type (Task 3) matches Task 4 usage.
- `rootApplyFieldUpdate` / `applyFieldUpdate` naming consistent — root destructures the composable's `applyFieldUpdate` as `rootApplyFieldUpdate` (Task 2), panes expose it directly (Task 6).
- `pendingSideEffect` shape (`Record<number, string>`) consistent across Tasks 4, 4 Step 3, 4 Step 4.

**Out-of-scope (not in plan):**

- Visual refinements to the sliver at depth ≥ 5.
- Keyboard navigation between panes.
- Pane breadcrumb trail.
- Performance optimisation for resolver fetches when the stack is deep.

Pick these up as follow-up tickets if the UX falls down in practice.
