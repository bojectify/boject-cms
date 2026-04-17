# Deep-linkable Entry Editor Panes (#59) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten the entry editor route from `/content-types/:id/entries/:entryId` to `/entries/[...stack]` — a catch-all that encodes an arbitrary-depth stack of open panes in the URL — so pane state is shareable, refreshable, and driven by routing.

**Architecture:** A single catch-all page (`pages/entries/[...stack].vue`) parses `route.params.stack` into an ordered list of segments separated by `~`. Segment 0 is the root entry being edited inline; segments 1..N render one `EntryEditorPane` each. Each segment is either a UUID (existing entry) or `new:<contentTypeId>` (unsaved new entry of that type). Opening a pane is `navigateTo(<current>/~/<segment>)`, closing is `navigateTo(<current minus last>)`. A `?pf=<fieldKey>` query parameter is set when a pane is opened from a parent's relation field and triggers a one-shot "add to parent field" side effect on save.

**Tech Stack:** Nuxt 4 (Vue 3), Vue Router (Nuxt's file-based routing with catch-all `[...param]`), Vitest for unit tests.

---

## File Map

**Create:**

- `utils/paneStack.ts` — Pure functions for parsing/encoding the `[...stack]` params into typed `PaneSegment[]`.
- `utils/paneStack.test.ts` — Unit tests for the parser/encoder.
- `pages/entries/[...stack].vue` — New catch-all page: root editor + N panes, all driven from `route.params.stack`.

**Modify:**

- `composables/useContentEntryEditor.ts` — Accept reactive refs for `contentTypeId` / `entryId` (optional; keep string overload for backward compatibility) so the pane can read from route params without needing a remount trick.
- `components/entry-editor-pane/EntryEditorPane.vue` — Expose `close` behaviour unchanged (emits `close`); parent owns navigation. Keep prop-driven.
- `components/entry-editor-pane/entryEditorPane.types.ts` — No change expected; confirm props still `{ open, contentTypeId, entryId, testId }`.
- `pages/index.vue` — Update row-link from `/content-types/<ctid>/entries/<id>` to `/entries/<id>`.
- `pages/content-types/[id]/entries/index.vue` — Update row-link + "Create" button link.
- `components/entry-sidebar/EntrySidebar.vue` — No change (already links to `/content-types/<ctid>`).

**Delete:**

- `pages/content-types/[id]/entries/[entryId].vue` — Replaced by `/entries/[...stack].vue`.
- `pages/content-types/[id]/entries/new.vue` — New entries now go via `/entries/new:<ctid>` sentinel.

**Redirect (add middleware):**

- `middleware/entry-redirect.global.ts` — Global client middleware redirecting legacy URLs (`/content-types/:id/entries/:entryId`, `/content-types/:id/entries/new`) to the new flat paths so bookmarks and older links keep working.

**Out of scope:**

- Persisting unsaved pane state across refresh (only saved entries can be deep-linked; `new:<ctid>` is transient — refresh drops unsaved data).
- Per-pane page titles in the browser tab (browser title uses root entry only).
- Pane-scoped route middleware or layouts.

---

## Data Model (stack segments)

```ts
// utils/paneStack.ts
export type PaneSegment =
  | { kind: 'entry'; entryId: string }
  | { kind: 'new'; contentTypeId: string };

// Parse params.stack: string[] (e.g. ['abc-uuid', '~', 'new:type-uuid', '~', 'def-uuid'])
// into: [{kind:'entry', entryId:'abc-uuid'}, {kind:'new', contentTypeId:'type-uuid'}, {kind:'entry', entryId:'def-uuid'}]
export function parseStack(segments: string[]): PaneSegment[];

// Encode PaneSegment[] to URL path (without /entries/ prefix):
// 'abc-uuid/~/new:type-uuid/~/def-uuid'
export function encodeStack(stack: PaneSegment[]): string;

// Build full href for a given stack
export function stackHref(stack: PaneSegment[]): string; // returns `/entries/${encodeStack(stack)}`
```

**Sentinel format:** `new:<contentTypeId>` — literal prefix `new:` then a UUID. Parser matches on the leading `new:`; anything else is treated as an entry UUID. UUIDs in this project are lowercase hex v4 so there's no collision with `new:`.

**Separator:** Literal `~` between segments. Invalid if it appears at start, end, or twice in a row — parser throws on malformed input and the page shows a 404.

---

## Task 1: Pane stack utilities (TDD)

**Files:**

- Create: `utils/paneStack.ts`
- Test: `utils/paneStack.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// utils/paneStack.test.ts
import { describe, expect, it } from 'vitest';
import {
  parseStack,
  encodeStack,
  stackHref,
  type PaneSegment,
} from './paneStack';

describe('parseStack', () => {
  it('parses a single entry', () => {
    expect(parseStack(['abc'])).toEqual([{ kind: 'entry', entryId: 'abc' }]);
  });

  it('parses an entry + pane', () => {
    expect(parseStack(['a', '~', 'b'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
    ]);
  });

  it('parses a new-entry sentinel', () => {
    expect(parseStack(['a', '~', 'new:type-uuid'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'new', contentTypeId: 'type-uuid' },
    ]);
  });

  it('parses a deep stack', () => {
    expect(parseStack(['a', '~', 'b', '~', 'new:t', '~', 'c'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
      { kind: 'new', contentTypeId: 't' },
      { kind: 'entry', entryId: 'c' },
    ]);
  });

  it('rejects empty input', () => {
    expect(() => parseStack([])).toThrow();
  });

  it('rejects leading separator', () => {
    expect(() => parseStack(['~', 'a'])).toThrow();
  });

  it('rejects trailing separator', () => {
    expect(() => parseStack(['a', '~'])).toThrow();
  });

  it('rejects double separator', () => {
    expect(() => parseStack(['a', '~', '~', 'b'])).toThrow();
  });

  it('rejects new sentinel without content type id', () => {
    expect(() => parseStack(['new:'])).toThrow();
  });
});

describe('encodeStack', () => {
  it('encodes a single entry', () => {
    expect(encodeStack([{ kind: 'entry', entryId: 'abc' }])).toBe('abc');
  });

  it('encodes an entry + pane', () => {
    expect(
      encodeStack([
        { kind: 'entry', entryId: 'a' },
        { kind: 'entry', entryId: 'b' },
      ])
    ).toBe('a/~/b');
  });

  it('encodes a new-entry sentinel', () => {
    expect(
      encodeStack([
        { kind: 'entry', entryId: 'a' },
        { kind: 'new', contentTypeId: 't' },
      ])
    ).toBe('a/~/new:t');
  });

  it('rejects empty stack', () => {
    expect(() => encodeStack([])).toThrow();
  });
});

describe('stackHref', () => {
  it('prepends /entries/', () => {
    expect(stackHref([{ kind: 'entry', entryId: 'a' }])).toBe('/entries/a');
  });
});

describe('round-trip', () => {
  const fixtures: PaneSegment[][] = [
    [{ kind: 'entry', entryId: 'a' }],
    [
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
    ],
    [
      { kind: 'entry', entryId: 'root' },
      { kind: 'new', contentTypeId: 'type-uuid' },
      { kind: 'entry', entryId: 'leaf' },
    ],
  ];

  for (const fixture of fixtures) {
    it(`round-trips: ${JSON.stringify(fixture)}`, () => {
      const encoded = encodeStack(fixture);
      const segments = encoded.split('/');
      expect(parseStack(segments)).toEqual(fixture);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run utils/paneStack.test.ts`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement the module**

```ts
// utils/paneStack.ts
export type PaneSegment =
  | { kind: 'entry'; entryId: string }
  | { kind: 'new'; contentTypeId: string };

const SEPARATOR = '~';
const NEW_PREFIX = 'new:';

function parseSegment(raw: string): PaneSegment {
  if (raw === SEPARATOR) {
    throw new Error('Unexpected separator while parsing segment');
  }
  if (raw.startsWith(NEW_PREFIX)) {
    const contentTypeId = raw.slice(NEW_PREFIX.length);
    if (!contentTypeId) {
      throw new Error('new: sentinel missing content type id');
    }
    return { kind: 'new', contentTypeId };
  }
  return { kind: 'entry', entryId: raw };
}

export function parseStack(segments: string[]): PaneSegment[] {
  if (segments.length === 0) {
    throw new Error('Stack is empty');
  }
  if (segments[0] === SEPARATOR) {
    throw new Error('Stack starts with separator');
  }
  if (segments[segments.length - 1] === SEPARATOR) {
    throw new Error('Stack ends with separator');
  }

  const result: PaneSegment[] = [];
  let expectingSeparator = false;

  for (const seg of segments) {
    if (expectingSeparator) {
      if (seg !== SEPARATOR) {
        throw new Error(`Expected separator, got "${seg}"`);
      }
      expectingSeparator = false;
    } else {
      result.push(parseSegment(seg));
      expectingSeparator = true;
    }
  }

  return result;
}

function encodeSegment(seg: PaneSegment): string {
  if (seg.kind === 'new') {
    return `${NEW_PREFIX}${seg.contentTypeId}`;
  }
  return seg.entryId;
}

export function encodeStack(stack: PaneSegment[]): string {
  if (stack.length === 0) {
    throw new Error('Cannot encode empty stack');
  }
  return stack.map(encodeSegment).join(`/${SEPARATOR}/`);
}

export function stackHref(stack: PaneSegment[]): string {
  return `/entries/${encodeStack(stack)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run utils/paneStack.test.ts`
Expected: PASS (all cases green)

- [ ] **Step 5: Commit**

```bash
git add utils/paneStack.ts utils/paneStack.test.ts
git commit -m "feat: add paneStack parse/encode utilities for entry deep-linking"
```

---

## Task 2: Catch-all entry editor page

**Files:**

- Create: `pages/entries/[...stack].vue`

This task moves the editor logic from `pages/content-types/[id]/entries/[entryId].vue` into the catch-all, with these behavioural changes:

- `contentTypeId` is derived from the loaded entry's API response, not the URL.
- For `new:<ctid>` the page acts like the old `new.vue` — no GET, empty formState.
- The template renders one root editor + zero-or-more `EntryEditorPane`s, one per segment after the first.
- Opening/closing panes call `navigateTo` with a new stack.
- Picker's `@create` / `@select` / `handleRelationEdit` all become navigation calls.

- [ ] **Step 1: Create the page with the root editor only**

```vue
<!-- pages/entries/[...stack].vue -->
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';
import { parseStack, stackHref, type PaneSegment } from '~/utils/paneStack';

const route = useRoute();
const router = useRouter();

const stackSegments = computed(() => {
  const raw = route.params.stack;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr as string[];
});

const parsedStack = computed<PaneSegment[]>(() => {
  try {
    return parseStack(stackSegments.value);
  } catch {
    return [];
  }
});

// Root is always the first segment
const root = computed<PaneSegment | null>(() => parsedStack.value[0] ?? null);
const paneSegments = computed<PaneSegment[]>(() => parsedStack.value.slice(1));

// If stack couldn't be parsed, throw 404 on the server / show error on client
if (parsedStack.value.length === 0) {
  throw createError({ statusCode: 404, statusMessage: 'Invalid entry path' });
}

// Fetch root entry (or skip for new)
const rootIsNew = computed(() => root.value?.kind === 'new');
const rootEntryId = computed(() =>
  root.value?.kind === 'entry' ? root.value.entryId : null
);
const rootContentTypeIdFromUrl = computed(() =>
  root.value?.kind === 'new' ? root.value.contentTypeId : null
);
</script>
```

- [ ] **Step 2: Port the full editor logic**

Copy the script-setup block from the old `[entryId].vue`, adapting:

- Replace `const contentTypeId = route.params.id as string` with a computed derived from the loaded entry (`entry.value?.contentTypeId` or the URL sentinel for `new`).
- Replace `const entryId = route.params.entryId as string` with `rootEntryId.value ?? 'new'`.
- Pass reactive refs to `useContentEntryEditor` (see Task 3).
- Keep all relation handling (openPicker, handlePickerSelect, handleRelationEdit, resolvedRelations, etc.) but have `handleRelationEdit`, `openPane`, and `handlePickerCreate` call `navigateTo` instead of mutating local state.

- [ ] **Step 3: Add the pane rendering**

```vue
<template>
  <div class="relative flex flex-col h-full overflow-hidden">
    <!-- Root editor (unchanged header + ContentEditor + EntrySidebar) -->
    <!-- ... existing root editor template ... -->

    <EntryPickerModal
      :open="pickerOpen"
      :target-content-type-ids="pickerTargetTypeIds"
      @select="handlePickerSelect"
      @create="handlePickerCreate"
      @close="pickerOpen = false"
    />

    <EntryEditorPane
      v-for="(pane, idx) in paneSegments"
      :key="encodePaneKey(pane, idx)"
      :open="true"
      :content-type-id="paneContentTypeId(pane)"
      :entry-id="paneEntryId(pane)"
      @close="closePane(idx)"
      @saved="(data) => handlePaneSaved(idx, data)"
    />
  </div>
</template>
```

Helper functions:

```ts
function encodePaneKey(pane: PaneSegment, idx: number): string {
  return pane.kind === 'entry'
    ? `${idx}:${pane.entryId}`
    : `${idx}:new:${pane.contentTypeId}`;
}

function paneContentTypeId(pane: PaneSegment): string {
  return pane.kind === 'new' ? pane.contentTypeId : ''; // pane fetches its own CT
}

function paneEntryId(pane: PaneSegment): string | null {
  return pane.kind === 'entry' ? pane.entryId : null;
}

function closePane(idx: number) {
  const newStack = parsedStack.value.slice(0, idx + 1);
  // idx is the pane's index in paneSegments; +1 because the root occupies index 0 in the full stack
  // closing the first pane (idx=0) navigates to just the root: slice(0, 1)
  router.push(stackHref(newStack));
}
```

- [ ] **Step 4: Wire navigation into existing openers**

Replace the old `openPane(targetContentTypeId, targetEntryId, fieldKey)` helper with:

```ts
function openPane(
  targetContentTypeId: string,
  targetEntryId: string | null,
  fieldKey: string
) {
  const newSegment: PaneSegment = targetEntryId
    ? { kind: 'entry', entryId: targetEntryId }
    : { kind: 'new', contentTypeId: targetContentTypeId };

  const newStack = [...parsedStack.value, newSegment];
  router.push({
    path: stackHref(newStack),
    query: { pf: fieldKey },
  });
}
```

And replace `handlePaneSaved` to read `pf` off the current route query, apply the side effect, and pop the pane:

```ts
function handlePaneSaved(
  paneIdx: number,
  data: { contentTypeId: string; entryId: string; entryTitle: string }
) {
  const pf = route.query.pf as string | undefined;
  if (pf) {
    // Apply the side-effect to the direct parent of the saved pane.
    // paneIdx is the pane's index within paneSegments (0-based from first pane).
    // In the current design the side-effect always targets the ROOT entry's
    // formState, which is only valid when paneIdx === 0. If we later support
    // deeper side-effects we'll route through each pane's own handler.
    if (paneIdx === 0) {
      applyFieldUpdate(pf, data);
    }
  }
  updateCache(data.contentTypeId, data.entryId, data.entryTitle);
  closePane(paneIdx);
}
```

- [ ] **Step 5: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pages/entries/[...stack].vue
git commit -m "feat: add catch-all entry editor with pane-stack routing"
```

---

## Task 3: Make useContentEntryEditor reactive

**Files:**

- Modify: `composables/useContentEntryEditor.ts`

The composable currently freezes `contentTypeId` / `entryId` strings. For the catch-all page, the root's contentTypeId comes from the entry fetch (async) and for panes it comes from the route. Supporting reactive input is cleaner than relying on remount tricks.

- [ ] **Step 1: Change the signature to accept `MaybeRefOrGetter`**

```ts
import { toValue, type MaybeRefOrGetter, type Ref } from 'vue';

export function useContentEntryEditor(
  contentTypeId: MaybeRefOrGetter<string>,
  entryId: MaybeRefOrGetter<string>
) {
  const contentTypeIdRef = computed(() => toValue(contentTypeId));
  const entryIdRef = computed(() => toValue(entryId));
  const toast = useToast();
  const isNew = computed(() => entryIdRef.value === 'new');
  // ... rest follows, using .value where the strings were
}
```

Key changes inside:

- `useAuthedFetch` URL becomes `() => /api/content-entries/${entryIdRef.value}` and uses `watch: [entryIdRef]`.
- `saveDraft` / `publish` POST body uses `contentTypeId: contentTypeIdRef.value`.
- `saveDraft` / `publish` / `discardChanges` PUT/DELETE URLs use `entryIdRef.value`.
- Guard: `if (isNew.value)` instead of `if (isNew)` in the conditional block that provides the empty data ref — but that block runs at setup and decides the refs. We'll switch it to a single `useAuthedFetch` that short-circuits when `entryId === 'new'` via `immediate: false` + a watcher.

Proposed rewrite of the data fetch:

```ts
const entry = ref<Record<string, unknown> | null>(null);
const loadingStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle');

async function loadEntry() {
  if (isNew.value) {
    entry.value = null;
    loadingStatus.value = 'success';
    return;
  }
  loadingStatus.value = 'pending';
  try {
    entry.value = await useRequestFetch()<Record<string, unknown>>(
      `/api/content-entries/${entryIdRef.value}`
    );
    loadingStatus.value = 'success';
  } catch (err) {
    entry.value = null;
    loadingStatus.value = 'error';
    throw err;
  }
}

watch(entryIdRef, loadEntry, { immediate: true });
```

Also update `refresh` to call `loadEntry`.

- [ ] **Step 2: Update existing call sites**

```ts
// pages/entries/[...stack].vue
const { formState, ... } = useContentEntryEditor(
  () => rootContentTypeId.value,
  () => rootEntryId.value ?? 'new'
);
```

```ts
// components/entry-editor-pane/EntryEditorPane.vue
// props.contentTypeId and props.entryId are already reactive via props,
// wrap in getters:
const { formState, ... } = useContentEntryEditor(
  () => props.contentTypeId,
  () => props.entryId ?? 'new'
);
```

With this change, the `:key` trick in `pages/content-types/[id]/entries/*` (added in #58) can stay for now — Task 8 deletes those files wholesale.

- [ ] **Step 3: Run affected tests**

Run: `pnpm test:unit && pnpm test:integration`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add composables/useContentEntryEditor.ts components/entry-editor-pane/EntryEditorPane.vue pages/entries/[...stack].vue
git commit -m "refactor: make useContentEntryEditor accept reactive refs"
```

---

## Task 4: Update internal links

**Files:**

- Modify: `pages/index.vue`
- Modify: `pages/content-types/[id]/entries/index.vue`

- [ ] **Step 1: Update root content listing**

```vue
<!-- pages/index.vue, line 24 -->
:row-link="(row) => `/entries/${row.id}`"
```

- [ ] **Step 2: Update per-type listing**

```vue
<!-- pages/content-types/[id]/entries/index.vue -->
:row-link="(row) => `/entries/${row.id}`"
<!-- Create button: -->
:to="`/entries/new:${contentTypeId}`"
```

- [ ] **Step 3: Verify by navigating in dev server**

Run: `pnpm dev`, open `/`, click a row, confirm URL is `/entries/<uuid>` and the editor renders. Open `/content-types/<ctid>/entries`, click "New", confirm URL is `/entries/new:<ctid>`.

- [ ] **Step 4: Commit**

```bash
git add pages/index.vue pages/content-types/[id]/entries/index.vue
git commit -m "feat: link content listings to flat /entries/:id route"
```

---

## Task 5: Legacy redirects

**Files:**

- Create: `middleware/entry-redirect.global.ts`

- [ ] **Step 1: Write the middleware**

```ts
// middleware/entry-redirect.global.ts
export default defineNuxtRouteMiddleware((to) => {
  // /content-types/:id/entries/new -> /entries/new:<id>
  const newMatch = to.path.match(/^\/content-types\/([^/]+)\/entries\/new\/?$/);
  if (newMatch) {
    return navigateTo(`/entries/new:${newMatch[1]}`, { replace: true });
  }

  // /content-types/:id/entries/:entryId -> /entries/:entryId
  const editMatch = to.path.match(
    /^\/content-types\/[^/]+\/entries\/([^/]+)\/?$/
  );
  if (editMatch) {
    return navigateTo(`/entries/${editMatch[1]}`, { replace: true });
  }
});
```

- [ ] **Step 2: Manual test**

In `pnpm dev`, navigate to `/content-types/abc/entries/def` and confirm URL rewrites to `/entries/def`.

- [ ] **Step 3: Commit**

```bash
git add middleware/entry-redirect.global.ts
git commit -m "feat: redirect legacy /content-types/:id/entries URLs to /entries/:id"
```

---

## Task 6: Delete old entry editor pages

**Files:**

- Delete: `pages/content-types/[id]/entries/[entryId].vue`
- Delete: `pages/content-types/[id]/entries/new.vue`

- [ ] **Step 1: Delete files**

```bash
git rm pages/content-types/[id]/entries/[entryId].vue
git rm pages/content-types/[id]/entries/new.vue
```

- [ ] **Step 2: Typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove old per-content-type entry editor routes"
```

---

## Task 7: Verification matrix

- [ ] **Step 1: Golden paths (manual, in `pnpm dev`)**

Test each:

- Open `/`, click an existing entry → `/entries/<id>` loads editor.
- Edit a text field, Save Draft → toast, form stays populated.
- Publish a draft → status badge flips to PUBLISHED.
- Discard Changes on a CHANGED entry → reverts to published.
- From an entry with a RELATION field, click Add → picker → "Create new" → pane opens → URL shows `/entries/<root>/~/new:<ctid>?pf=<fieldKey>`.
- Fill + Save Draft in pane → URL rewrites to `/entries/<root>/~/<newEntryId>?pf=<fieldKey>`, parent field populates, pane closes, URL becomes `/entries/<root>`.
- From an entry with an existing relation, click the relation card → pane opens at `/entries/<root>/~/<relationEntryId>` → editing + save works → close → URL pops.
- Copy the URL while a pane is open, paste in a new tab → same pane stack renders.
- Back button closes panes one at a time.
- Visit a legacy URL like `/content-types/<ctid>/entries/<eid>` → redirects to `/entries/<eid>`.

- [ ] **Step 2: Automated regression**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git commit -m "chore: manual verification pass for entry route catch-all"
```

---

## Self-Review Notes

- `useContentEntryEditor` rewrite drops an existing `await useAuthedFetch(...)` boundary. Integration tests that depend on SSR data being present at render need to still pass — the `immediate: true` watcher keeps the same semantics.
- `useRequestFetch()` is the SSR-safe equivalent for imperative calls per CLAUDE.md. Keep it.
- The `?pf=<fieldKey>` query param only supports side-effects against the root entry. Deeper-than-one-level side effects are noted in code (comment in `handlePaneSaved`) and deferred — the URL scheme already supports it, the wiring just isn't there.
- The `:key` workaround from #58 is removed as part of Task 6 (the files are gone).
