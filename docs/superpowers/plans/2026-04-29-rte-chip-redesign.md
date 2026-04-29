# RTE Chip Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the rich text editor's `cmsLink` (mark), external `Link` (mark), and `cmsEmbed` (atom node) to a uniform chip-based atom-node model. Add `target` / `rel` attrs on link nodes, click-to-edit interaction, EntryPickerModal preselect, and an external-link edit modal. Fix two focus-outline bugs.

**Architecture:** Server-side walkers/validators collapse from dual nodes-and-marks walkers to nodes-only. Three Tiptap atom nodes (`cmsEmbed`, `cmsLink`, `externalLink`) render as visually consistent chips via Vue node views. Toolbar buttons become insert-only; clicking any chip opens its edit modal preloaded with current attrs. Schema swap is clean (no migration shim — `cmsLink` mark only landed days ago, no fixtures or starter bundles use it).

**Tech Stack:** Vue 3 SFCs, scoped CSS + `:deep` (existing convention in this file), Tailwind v4, Nuxt UI v3, Tiptap (`@tiptap/vue-3`, `@tiptap/core`), Vitest, Storybook 10. Server-side: Nuxt 4 / Nitro h3 handlers, pure-function walkers.

**Spec:** `docs/superpowers/specs/2026-04-29-rte-chip-redesign-design.md` (this work supersedes parts of the earlier `2026-04-29-rte-editor-presentation-fixes-design.md` — see "What this spec changes from the first spec").

---

## File Structure

| File                                                                  | Change  | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cms/server/utils/collectRichtextReferences.ts`                  | Modify  | Walker becomes nodes-only (cmsEmbed + cmsLink as inline atom nodes; externalLink ignored).                                                                                                                                                                                                                                                                                                                               |
| `apps/cms/server/utils/collectRichtextReferences.test.ts`             | Modify  | Test fixtures migrate to cmsLink-as-node shape.                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/cms/server/utils/enrichRichtextEmbeds.ts`                       | Modify  | `collectEmbedContentTypeIds` and `enrichBodyWithContentTypeIdentifiers` walkers become nodes-only. Add server-side rel injection on cmsLink/externalLink nodes with `target='_blank'`.                                                                                                                                                                                                                                   |
| `apps/cms/server/utils/enrichRichtextEmbeds.test.ts`                  | Modify  | Fixture migration + new rel-injection tests.                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/cms/server/utils/validateEntryData.ts`                          | Modify  | `validateRichtextReferences` becomes nodes-only for cmsLink. Add externalLink scheme/href validation.                                                                                                                                                                                                                                                                                                                    |
| `apps/cms/server/utils/validateEntryData.test.ts`                     | Modify  | Fixture migration + externalLink validation cases.                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/cms/server/api/content-entries/content-entries.test.ts`         | Modify  | RICHTEXT integration test fixtures migrate from cmsLink-mark to cmsLink-node shape.                                                                                                                                                                                                                                                                                                                                      |
| `apps/cms/server/api/graphql/graphql.test.ts`                         | Modify  | RichText query fixtures migrate from cmsLink-mark to cmsLink-node shape.                                                                                                                                                                                                                                                                                                                                                 |
| `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`         | Modify  | Add optional `label` attr.                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`          | Rewrite | Mark → Node with `label`, `target`, `rel` attrs. New `insertCmsLink` command.                                                                                                                                                                                                                                                                                                                                            |
| `apps/cms/components/rich-text-editor/extensions/ExternalLink.ts`     | Create  | New atom node with `href`, `label`, `target`, `rel`. New `insertExternalLink` command.                                                                                                                                                                                                                                                                                                                                   |
| `apps/cms/components/link-options-form/LinkOptionsForm.vue`           | Create  | Shared sub-component: Display text, target toggle, rel toggle. v-model `{ label, target, rel }`.                                                                                                                                                                                                                                                                                                                         |
| `apps/cms/components/link-options-form/linkOptionsForm.config.ts`     | Create  | Test IDs.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/cms/components/link-options-form/linkOptionsForm.types.ts`      | Create  | `LinkOptions` type + `LinkOptionsFormProps`.                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/cms/components/external-link-modal/ExternalLinkModal.vue`       | Create  | URL + LinkOptionsForm modal. Save / Remove / Cancel. Emits `save`, `remove`, `close`.                                                                                                                                                                                                                                                                                                                                    |
| `apps/cms/components/external-link-modal/externalLinkModal.config.ts` | Create  | Test IDs.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/cms/components/external-link-modal/externalLinkModal.types.ts`  | Create  | `ExternalLinkModalProps`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/cms/components/entry-picker-modal/EntryPickerModal.vue`         | Modify  | Add `mode`, `selectedEntry`, `initialOptions` props. Preselect highlight + scroll-into-view. Save / Remove footer. New `update` / `remove` emits.                                                                                                                                                                                                                                                                        |
| `apps/cms/components/entry-picker-modal/entryPickerModal.types.ts`    | Modify  | Extend `EntryPickerModalProps`; add emit signatures.                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue`           | Modify  | Add `label` fallback. Wrap in `.rich-text-editor__chip` class. Click-to-edit handler via injected `openEditChip` token.                                                                                                                                                                                                                                                                                                  |
| `apps/cms/components/rich-text-editor/CmsLinkNodeView.vue`            | Create  | New chip with chain icon. Same resolver + click pattern as cmsEmbed.                                                                                                                                                                                                                                                                                                                                                     |
| `apps/cms/components/rich-text-editor/ExternalLinkNodeView.vue`       | Create  | New chip with external-link icon. Domain extraction; no resolver.                                                                                                                                                                                                                                                                                                                                                        |
| `apps/cms/components/rich-text-editor/RichTextEditor.vue`             | Modify  | Wire new extensions; remove `@tiptap/extension-link` import; configure StarterKit without `link`. Manage modal state per chip type. Provide `openEditChip` injection. Wire toolbar buttons to insert flows. Static `color="neutral"` on link buttons. Add `.rich-text-editor__chip` styles. Revert Task 3 link-mark CSS. Move `p-4` from EditorContent to ProseMirror root; add `:deep(h1:first-child) { @apply mt-0 }`. |
| `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`      | Modify  | Sample doc moves to nodes-only shape.                                                                                                                                                                                                                                                                                                                                                                                    |

The four pre-existing per-component config/types files (`*.config.ts`, `*.types.ts`) follow the codebase convention documented in `CLAUDE.md` ("Component layout convention").

---

### Task 1: Server walker refactor (collect + enrich) — nodes-only

**Files:**

- Modify: `apps/cms/server/utils/collectRichtextReferences.ts`
- Modify: `apps/cms/server/utils/collectRichtextReferences.test.ts`
- Modify: `apps/cms/server/utils/enrichRichtextEmbeds.ts`
- Modify: `apps/cms/server/utils/enrichRichtextEmbeds.test.ts`

- [ ] **Step 1: Update test helper in `collectRichtextReferences.test.ts`**

In `apps/cms/server/utils/collectRichtextReferences.test.ts`, replace the helper:

```ts
const cmsLinkMark = (contentTypeId: string, entryId: string) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId },
});
```

with:

```ts
const cmsLinkNode = (contentTypeId: string, entryId: string) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId },
});
```

Then for every test case, change call sites from the mark shape — `text('Click', [cmsLinkMark('ct-2', 'e-2')])` (cmsLink as a `marks` entry on a text node) — to the node shape — `cmsLinkNode('ct-2', 'e-2')` (a sibling inline node alongside text in the paragraph's `content`).

Example diff for one test case:

```ts
// before
collectRichtextReferences(
  doc([para([text('Click', [cmsLinkMark('ct-2', 'e-2')])])])
);
// after
collectRichtextReferences(
  doc([para([text('Before '), cmsLinkNode('ct-2', 'e-2'), text(' after')])])
);
```

Apply this pattern to every existing test case that uses `cmsLinkMark`. Keep the `externalLinkMark` helper for now (it tests that legacy stock-Link marks are ignored — we will rename it in Step 2 once the new shape lands).

- [ ] **Step 2: Add new test cases for the nodes-only shape**

Append these tests at the end of the existing `describe` block in `collectRichtextReferences.test.ts`:

```ts
it('ignores externalLink nodes (no contentTypeId)', () => {
  const externalLinkNode = (href: string) => ({
    type: 'externalLink',
    attrs: { href },
  });
  expect(
    collectRichtextReferences(
      doc([
        para([
          text('See '),
          externalLinkNode('https://example.com'),
          text(' for details'),
        ]),
      ])
    )
  ).toEqual([]);
});

it('ignores cmsLink nodes with empty / missing ids (defensive)', () => {
  expect(
    collectRichtextReferences(
      doc([
        para([
          { type: 'cmsLink', attrs: { contentTypeId: '', entryId: 'e-1' } },
          { type: 'cmsLink', attrs: { entryId: 'e-2' } },
        ]),
      ])
    )
  ).toEqual([]);
});
```

- [ ] **Step 3: Run tests — they should fail**

Run: `pnpm vitest run apps/cms/server/utils/collectRichtextReferences.test.ts`
Expected: FAIL — the walker still treats cmsLink as a mark on text nodes; the new node-shape inputs return `[]` instead of the expected refs.

- [ ] **Step 4: Update `collectRichtextReferences.ts` to nodes-only**

Replace the body of `walk` in `apps/cms/server/utils/collectRichtextReferences.ts`:

```ts
function walk(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (!node || typeof node !== 'object') return;
  const n = node as {
    type?: unknown;
    attrs?: unknown;
    content?: unknown;
  };

  if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
    pushIfValid(n.attrs);
  }

  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, depth + 1);
  }
}
```

Also update the JSDoc above the function to drop the "mark on text node" sentence and replace with:

```ts
/**
 * Walk a ProseMirror JSON document and return the deduplicated set of
 * (contentTypeId, entryId) pairs referenced by `cmsEmbed` and `cmsLink`
 * inline atom nodes. `externalLink` nodes are ignored (they reference URLs,
 * not entries).
 *
 * Order is document-traversal order. The pair `(ct, e)` appears at most once
 * even if it occurs multiple times across cmsEmbed and cmsLink nodes. Pairs
 * with missing, non-string, or empty-string ids are silently skipped.
 *
 * Recursion is capped at depth 1000; references deeper than that are silently
 * dropped.
 */
```

- [ ] **Step 5: Run tests — confirm pass**

Run: `pnpm vitest run apps/cms/server/utils/collectRichtextReferences.test.ts`
Expected: PASS for all cases including the two new ones.

- [ ] **Step 6: Update test fixtures + helpers in `enrichRichtextEmbeds.test.ts`**

In `apps/cms/server/utils/enrichRichtextEmbeds.test.ts`, do the same helper rename + call-site migration described in Step 1 (cmsLink mark on text → cmsLink inline atom node sibling). The file uses similar fixture-builder helpers.

Append two new test cases at the end:

```ts
it('stamps contentTypeIdentifier on cmsLink nodes', async () => {
  const body = doc([
    para([
      text('See '),
      { type: 'cmsLink', attrs: { contentTypeId: 'ct-author', entryId: 'a1' } },
      text(' for details'),
    ]),
  ]);
  const enriched = enrichBodyWithContentTypeIdentifiers(
    body,
    new Map([['ct-author', 'Author']])
  );
  // walk to find the cmsLink node and assert the identifier was stamped
  const para0 = (enriched as { content: { content: unknown[] }[] }).content[0]!;
  const cmsLinkNode = para0.content.find(
    (n: unknown): n is { attrs: Record<string, unknown> } =>
      typeof n === 'object' &&
      n !== null &&
      (n as { type?: string }).type === 'cmsLink'
  )!;
  expect(cmsLinkNode.attrs.contentTypeIdentifier).toBe('Author');
});

it('stamps rel="noopener noreferrer" on cmsLink nodes with target="_blank"', () => {
  const body = doc([
    para([
      {
        type: 'cmsLink',
        attrs: {
          contentTypeId: 'ct-author',
          entryId: 'a1',
          target: '_blank',
        },
      },
    ]),
  ]);
  const enriched = enrichBodyWithContentTypeIdentifiers(
    body,
    new Map([['ct-author', 'Author']])
  );
  const para0 = (enriched as { content: { content: unknown[] }[] }).content[0]!;
  const cmsLinkNode = para0.content[0] as { attrs: Record<string, unknown> };
  expect(cmsLinkNode.attrs.rel).toBe('noopener noreferrer');
});

it('stamps rel="nofollow noopener noreferrer" when target=_blank and rel=nofollow', () => {
  const body = doc([
    para([
      {
        type: 'externalLink',
        attrs: {
          href: 'https://example.com',
          target: '_blank',
          rel: 'nofollow',
        },
      },
    ]),
  ]);
  const enriched = enrichBodyWithContentTypeIdentifiers(body, new Map());
  const para0 = (enriched as { content: { content: unknown[] }[] }).content[0]!;
  const node = para0.content[0] as { attrs: Record<string, unknown> };
  expect(node.attrs.rel).toBe('nofollow noopener noreferrer');
});

it('does not modify rel when target is not _blank', () => {
  const body = doc([
    para([
      {
        type: 'externalLink',
        attrs: { href: 'https://example.com', rel: 'nofollow' },
      },
    ]),
  ]);
  const enriched = enrichBodyWithContentTypeIdentifiers(body, new Map());
  const para0 = (enriched as { content: { content: unknown[] }[] }).content[0]!;
  const node = para0.content[0] as { attrs: Record<string, unknown> };
  expect(node.attrs.rel).toBe('nofollow');
});
```

- [ ] **Step 7: Run tests — they should fail**

Run: `pnpm vitest run apps/cms/server/utils/enrichRichtextEmbeds.test.ts`
Expected: FAIL — old tests fail because the walker still recognizes the mark shape (which we removed from fixtures). New tests fail because rel injection doesn't exist yet.

- [ ] **Step 8: Update `enrichRichtextEmbeds.ts` walkers + add rel injection**

In `apps/cms/server/utils/enrichRichtextEmbeds.ts`:

(a) Replace the body of `collectEmbedContentTypeIds`:

```ts
export function collectEmbedContentTypeIds(
  body: unknown,
  out: Set<string> = new Set()
): Set<string> {
  if (!body || typeof body !== 'object') return out;
  const n = body as {
    type?: unknown;
    attrs?: unknown;
    content?: unknown;
  };
  if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (typeof attrs.contentTypeId === 'string' && attrs.contentTypeId !== '') {
      out.add(attrs.contentTypeId);
    }
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      collectEmbedContentTypeIds(child, out);
    }
  }
  return out;
}
```

(b) Replace the body of `enrichBodyWithContentTypeIdentifiers`:

```ts
export function enrichBodyWithContentTypeIdentifiers(
  body: unknown,
  identifierMap: Map<string, string>
): unknown {
  if (!body || typeof body !== 'object') return body;

  const n = body as {
    type?: unknown;
    attrs?: unknown;
    content?: unknown;
    [key: string]: unknown;
  };

  let result: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;

  if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    let nextAttrs: Record<string, unknown> = { ...attrs };

    const identifier =
      typeof attrs.contentTypeId === 'string'
        ? identifierMap.get(attrs.contentTypeId)
        : undefined;
    if (identifier !== undefined) {
      nextAttrs.contentTypeIdentifier = identifier;
    }

    nextAttrs = applyRelInjection(nextAttrs);
    result = { ...result, attrs: nextAttrs };
  } else if (n.type === 'externalLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    result = { ...result, attrs: applyRelInjection({ ...attrs }) };
  }

  if (Array.isArray(n.content)) {
    const newContent = n.content.map((child) =>
      enrichBodyWithContentTypeIdentifiers(child, identifierMap)
    );
    result = { ...result, content: newContent };
  }

  return result;
}

/**
 * Stamp `noopener noreferrer` onto link nodes with `target='_blank'`.
 * Defence-in-depth: external consumers reading `body.json` see the safe
 * rel value regardless of what the editor emitted.
 */
function applyRelInjection(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  if (attrs.target !== '_blank') return attrs;
  const existing = typeof attrs.rel === 'string' ? attrs.rel.trim() : '';
  const safety = ['noopener', 'noreferrer'];
  const tokens = existing ? existing.split(/\s+/) : [];
  for (const t of safety) {
    if (!tokens.includes(t)) tokens.push(t);
  }
  return { ...attrs, rel: tokens.join(' ') };
}
```

- [ ] **Step 9: Update the JSDoc** above `collectEmbedContentTypeIds` and `enrichBodyWithContentTypeIdentifiers` to drop the "mark on text node" language and describe the nodes-only behaviour plus the rel-injection step.

Replace `collectEmbedContentTypeIds`'s JSDoc with:

```ts
/**
 * Collect the unique set of `contentTypeId`s referenced anywhere in a
 * ProseMirror JSON document tree by `cmsEmbed` and `cmsLink` inline atom
 * nodes (attrs.contentTypeId).
 *
 * Empty-string and non-string ids are skipped so they don't pollute the
 * downstream identifier-load query.
 */
```

Replace `enrichBodyWithContentTypeIdentifiers`'s JSDoc with:

```ts
/**
 * Walk a ProseMirror JSON document and return a new document where:
 *   - every `cmsEmbed` and `cmsLink` node's `attrs` has `contentTypeIdentifier`
 *     stamped from `identifierMap` (if a mapping exists);
 *   - every `cmsLink` and `externalLink` node with `target='_blank'` has
 *     `noopener noreferrer` injected into its `rel`, preserving any existing
 *     tokens such as `nofollow`.
 *
 * Nodes whose `contentTypeId` is absent from the map are left untouched
 * (defensive — the validator already enforced allow-list membership).
 *
 * The function is purely functional — the input tree is never mutated.
 */
```

- [ ] **Step 10: Run tests — confirm pass**

Run: `pnpm vitest run apps/cms/server/utils/enrichRichtextEmbeds.test.ts apps/cms/server/utils/collectRichtextReferences.test.ts`
Expected: PASS for all cases.

- [ ] **Step 11: Commit**

```bash
git add apps/cms/server/utils/collectRichtextReferences.ts apps/cms/server/utils/collectRichtextReferences.test.ts apps/cms/server/utils/enrichRichtextEmbeds.ts apps/cms/server/utils/enrichRichtextEmbeds.test.ts
git commit -m "refactor(richtext): server walkers nodes-only + rel injection (#115)"
```

---

### Task 2: Server validator refactor — nodes-only + externalLink

**Files:**

- Modify: `apps/cms/server/utils/validateEntryData.ts` (function `validateRichtextReferences`, around lines 338-422)
- Modify: `apps/cms/server/utils/validateEntryData.test.ts`

- [ ] **Step 1: Update existing test fixtures**

In `apps/cms/server/utils/validateEntryData.test.ts`, find every fixture using cmsLink as a mark on a text node and migrate to cmsLink as an inline atom node sibling. Pattern:

```ts
// before
{ type: 'text', text: 'click', marks: [{ type: 'cmsLink', attrs: { contentTypeId: 'ct-1', entryId: 'e-1' } }] }
// after
{ type: 'cmsLink', attrs: { contentTypeId: 'ct-1', entryId: 'e-1' } }
```

- [ ] **Step 2: Add new test cases**

Append at the end of the RICHTEXT-relevant `describe` block (or create a new one if none exists for richtext). The exact `describe` location to append to: search for `describe(` blocks that test `validateRichtextReferences` directly or RICHTEXT field validation; add inside the most specific match.

```ts
it('rejects externalLink with missing href', async () => {
  const fields = [
    {
      identifier: 'body',
      type: 'RICHTEXT',
      name: 'Body',
      required: false,
      options: {},
    },
  ];
  const data = {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'externalLink', attrs: {} }],
        },
      ],
    },
  };
  await expect(
    validateEntryData(data, fields as never, prismaMock as never)
  ).rejects.toMatchObject({ statusCode: 400 });
});

it('accepts externalLink with valid http/https/mailto/tel href', async () => {
  const fields = [
    {
      identifier: 'body',
      type: 'RICHTEXT',
      name: 'Body',
      required: false,
      options: {},
    },
  ];
  for (const href of [
    'https://example.com',
    'http://example.com',
    'mailto:hello@example.com',
    'tel:+441234567890',
  ]) {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'externalLink', attrs: { href } }],
          },
        ],
      },
    };
    await expect(
      validateEntryData(data, fields as never, prismaMock as never)
    ).resolves.toBeDefined();
  }
});

it('rejects externalLink with javascript: scheme', async () => {
  const fields = [
    {
      identifier: 'body',
      type: 'RICHTEXT',
      name: 'Body',
      required: false,
      options: {},
    },
  ];
  const data = {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'externalLink',
              attrs: { href: 'javascript:alert(1)' },
            },
          ],
        },
      ],
    },
  };
  await expect(
    validateEntryData(data, fields as never, prismaMock as never)
  ).rejects.toMatchObject({ statusCode: 400 });
});

it('rejects cmsLink node when allow-list is empty', async () => {
  const fields = [
    {
      identifier: 'body',
      type: 'RICHTEXT',
      name: 'Body',
      required: false,
      options: {},
    },
  ];
  const data = {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsLink',
              attrs: { contentTypeId: 'ct-1', entryId: 'e-1' },
            },
          ],
        },
      ],
    },
  };
  await expect(
    validateEntryData(data, fields as never, prismaMock as never)
  ).rejects.toMatchObject({
    statusCode: 400,
    statusMessage: expect.stringContaining('Entry links are not allowed'),
  });
});

it('rejects cmsLink node referencing a content type outside the allow-list', async () => {
  const fields = [
    {
      identifier: 'body',
      type: 'RICHTEXT',
      name: 'Body',
      required: false,
      options: { linkTargetContentTypeIds: ['ct-allowed'] },
    },
  ];
  const data = {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsLink',
              attrs: { contentTypeId: 'ct-not-allowed', entryId: 'e-1' },
            },
          ],
        },
      ],
    },
  };
  await expect(
    validateEntryData(data, fields as never, prismaMock as never)
  ).rejects.toMatchObject({ statusCode: 400 });
});
```

If your test file does not have a `prismaMock` fixture, the existing tests will tell you the variable name they use — keep using whatever the file establishes.

- [ ] **Step 3: Run tests — they should fail**

Run: `pnpm vitest run apps/cms/server/utils/validateEntryData.test.ts`
Expected: FAIL — pre-existing tests still pass against mark-shape fixtures we just removed; new tests fail because externalLink validation doesn't exist and cmsLink-as-node isn't checked.

- [ ] **Step 4: Update `validateRichtextReferences` in `validateEntryData.ts`**

Replace the function body (around lines 347-422). The new version walks nodes only, validates cmsLink as a node, and adds an `externalLink` branch:

```ts
const ALLOWED_EXTERNAL_LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

function validateRichtextReferences(
  doc: unknown,
  allowedEmbedTypes: string[],
  allowedLinkTypes: string[],
  fieldName: string
): void {
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: unknown;
      attrs?: unknown;
      content?: unknown;
    };

    if (n.type === 'cmsEmbed') {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (
        typeof attrs.contentTypeId !== 'string' ||
        typeof attrs.entryId !== 'string'
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Invalid inline embed (missing contentTypeId or entryId).`,
        });
      }
      if (allowedEmbedTypes.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embeds are not allowed in this field.`,
        });
      }
      if (!allowedEmbedTypes.includes(attrs.contentTypeId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embed references a content type that is not allowed for this field.`,
        });
      }
    }

    if (n.type === 'cmsLink') {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (
        typeof attrs.contentTypeId !== 'string' ||
        typeof attrs.entryId !== 'string'
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Invalid entry link (missing contentTypeId or entryId).`,
        });
      }
      if (allowedLinkTypes.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Entry links are not allowed in this field.`,
        });
      }
      if (!allowedLinkTypes.includes(attrs.contentTypeId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Entry link references a content type that is not allowed for this field.`,
        });
      }
    }

    if (n.type === 'externalLink') {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      const href = attrs.href;
      if (typeof href !== 'string' || href.trim() === '') {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: External link is missing href.`,
        });
      }
      let parsed: URL;
      try {
        parsed = new URL(href);
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: External link href is not a valid URL.`,
        });
      }
      if (!ALLOWED_EXTERNAL_LINK_SCHEMES.includes(parsed.protocol)) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: External link scheme '${parsed.protocol}' is not allowed.`,
        });
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
}
```

Update the JSDoc above the function:

```ts
/**
 * Walk a ProseMirror JSON document, asserting:
 *   - every `cmsEmbed` node's `contentTypeId` is in `allowedEmbedTypes`;
 *   - every `cmsLink` node's `contentTypeId` is in `allowedLinkTypes`;
 *   - every `externalLink` node has a non-empty href that parses as a URL
 *     with one of the allowed schemes (http, https, mailto, tel).
 * Empty allow-lists for embed/link mean the corresponding feature is not
 * allowed at all. URL-parse failures and disallowed schemes throw 400.
 */
```

- [ ] **Step 5: Run tests — confirm pass**

Run: `pnpm vitest run apps/cms/server/utils/validateEntryData.test.ts`
Expected: PASS — all migrated and new tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/validateEntryData.ts apps/cms/server/utils/validateEntryData.test.ts
git commit -m "refactor(richtext): nodes-only validator + externalLink scheme allow-list (#115)"
```

---

### Task 3: Migrate integration test fixtures (cmsLink mark → node)

**Files:**

- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`
- Modify: `apps/cms/server/api/graphql/graphql.test.ts`

- [ ] **Step 1: Migrate `content-entries.test.ts`**

Run: `grep -n "cmsLink" apps/cms/server/api/content-entries/content-entries.test.ts`

For each match, the cmsLink usage will be the mark-on-text shape:

```ts
{ type: 'text', text: 'click', marks: [{ type: 'cmsLink', attrs: { contentTypeId, entryId } }] }
```

Migrate each to the inline-atom-node shape:

```ts
{ type: 'cmsLink', attrs: { contentTypeId, entryId } }
```

If the surrounding test asserts that the saved body still contains the cmsLink reference with `contentTypeIdentifier` stamped, update the assertion to find the cmsLink **node** (not a mark) — i.e. walk `paragraph.content` instead of `text.marks`.

- [ ] **Step 2: Migrate `graphql.test.ts`**

Same migration in `apps/cms/server/api/graphql/graphql.test.ts`. Particular attention to lines around 1149-1239 (the "cmsEmbed nodes and cmsLink marks combined" test) and 1300 (the "cmsLink rejection" test). The combined test should be retitled to drop the "marks" wording.

The assertion block at lines 1226-1240 currently extracts `cmsLinkMarks` from `text.marks[]`. Replace with a node-walker:

```ts
// Confirm cmsLink nodes in the round-tripped json carry the
// contentTypeIdentifier stamped at save time.
const cmsLinkNodes: Array<{ attrs: Record<string, unknown> }> = [];
function walkForCmsLink(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
  if (n.type === 'cmsLink') {
    cmsLinkNodes.push({ attrs: (n.attrs ?? {}) as Record<string, unknown> });
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) walkForCmsLink(child);
  }
}
walkForCmsLink(roundTripped);
expect(cmsLinkNodes).toHaveLength(2);
for (const m of cmsLinkNodes) {
  expect(m.attrs.contentTypeIdentifier).toBeTruthy();
}
```

(Use the variable name your test file already uses for the round-tripped doc instead of `roundTripped`.)

- [ ] **Step 3: Run integration tests — confirm pass**

Run: `pnpm test:integration` (filtered if needed: `pnpm vitest run apps/cms/server/api/content-entries apps/cms/server/api/graphql`)
Expected: PASS for all richtext-related cases.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/server/api/content-entries/content-entries.test.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "test(richtext): migrate integration fixtures to cmsLink-as-node (#115)"
```

---

### Task 4: Tiptap extension swap

**Files:**

- Modify: `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`
- Rewrite: `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`
- Create: `apps/cms/components/rich-text-editor/extensions/ExternalLink.ts`
- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (extensions array, drop `@tiptap/extension-link`)

- [ ] **Step 1: Add `label` attr to `CmsEmbed.ts`**

In `apps/cms/components/rich-text-editor/extensions/CmsEmbed.ts`, extend the `addAttributes` block (currently has `contentTypeId`, `entryId`, `contentTypeIdentifier`) with a new `label` attr. Final shape:

```ts
addAttributes() {
  return {
    contentTypeId: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-content-type-id'),
      renderHTML: (attrs) =>
        attrs.contentTypeId
          ? { 'data-content-type-id': attrs.contentTypeId as string }
          : {},
    },
    entryId: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-entry-id'),
      renderHTML: (attrs) =>
        attrs.entryId ? { 'data-entry-id': attrs.entryId as string } : {},
    },
    contentTypeIdentifier: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-content-type-identifier'),
      renderHTML: (attrs) =>
        attrs.contentTypeIdentifier
          ? {
              'data-content-type-identifier':
                attrs.contentTypeIdentifier as string,
            }
          : {},
    },
    label: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-label'),
      renderHTML: (attrs) =>
        attrs.label ? { 'data-label': attrs.label as string } : {},
    },
  };
},
```

Confirm the existing `parseHTML` / `renderHTML` / `addCommands` / `addNodeView` blocks below remain unchanged.

- [ ] **Step 2: Rewrite `CmsLink.ts` from Mark to Node**

Replace the entire content of `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`:

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsLinkNodeView from '../CmsLinkNodeView.vue';

export interface CmsLinkAttrs {
  contentTypeId: string | null;
  entryId: string | null;
  contentTypeIdentifier: string | null;
  label: string | null;
  target: '_self' | '_blank' | null;
  rel: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsLink: {
      insertCmsLink: (attrs: {
        contentTypeId: string;
        entryId: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | null;
      }) => ReturnType;
    };
  }
}

export const CmsLink = Node.create({
  name: 'cmsLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      contentTypeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-content-type-id'),
        renderHTML: (attrs) =>
          attrs.contentTypeId
            ? { 'data-content-type-id': attrs.contentTypeId as string }
            : {},
      },
      entryId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-entry-id'),
        renderHTML: (attrs) =>
          attrs.entryId ? { 'data-entry-id': attrs.entryId as string } : {},
      },
      contentTypeIdentifier: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-content-type-identifier'),
        renderHTML: (attrs) =>
          attrs.contentTypeIdentifier
            ? {
                'data-content-type-identifier':
                  attrs.contentTypeIdentifier as string,
              }
            : {},
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label as string } : {},
      },
      target: {
        default: null,
        parseHTML: (el) => el.getAttribute('target'),
        renderHTML: (attrs) =>
          attrs.target ? { target: attrs.target as string } : {},
      },
      rel: {
        default: null,
        parseHTML: (el) => el.getAttribute('rel'),
        renderHTML: (attrs) => (attrs.rel ? { rel: attrs.rel as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cms-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-cms-link': '' })];
  },

  addCommands() {
    return {
      insertCmsLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsLinkNodeView);
  },
});
```

Note: the import for `CmsLinkNodeView` is forward — that file is created in Task 8. To keep this commit's typecheck green, either:

(a) Land Task 4 + Task 8 in the same commit (large), or
(b) Stub `CmsLinkNodeView.vue` with a minimal placeholder in this task and replace in Task 8.

Use option (b). Stub is minimal:

```vue
<!-- placeholder, replaced in Task 8 -->
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
</script>
<template>
  <NodeViewWrapper as="span" />
</template>
```

Save this stub to `apps/cms/components/rich-text-editor/CmsLinkNodeView.vue`.

- [ ] **Step 3: Create `ExternalLink.ts`**

Create `apps/cms/components/rich-text-editor/extensions/ExternalLink.ts` with:

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ExternalLinkNodeView from '../ExternalLinkNodeView.vue';

export interface ExternalLinkAttrs {
  href: string;
  label: string | null;
  target: '_self' | '_blank' | null;
  rel: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    externalLink: {
      insertExternalLink: (attrs: {
        href: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | null;
      }) => ReturnType;
    };
  }
}

export const ExternalLink = Node.create({
  name: 'externalLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (el) => el.getAttribute('href') ?? '',
        renderHTML: (attrs) =>
          attrs.href ? { href: attrs.href as string } : {},
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label as string } : {},
      },
      target: {
        default: null,
        parseHTML: (el) => el.getAttribute('target'),
        renderHTML: (attrs) =>
          attrs.target ? { target: attrs.target as string } : {},
      },
      rel: {
        default: null,
        parseHTML: (el) => el.getAttribute('rel'),
        renderHTML: (attrs) => (attrs.rel ? { rel: attrs.rel as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-external-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-external-link': '' })];
  },

  addCommands() {
    return {
      insertExternalLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(ExternalLinkNodeView);
  },
});
```

Stub `apps/cms/components/rich-text-editor/ExternalLinkNodeView.vue` with the same minimal placeholder used in Step 2.

- [ ] **Step 4: Update `RichTextEditor.vue` extensions array**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`:

(a) Remove the import `import Link from '@tiptap/extension-link';` at the top of the `<script setup>` block.

(b) Add: `import { ExternalLink } from './extensions/ExternalLink';`

(c) In the `extensions` computed, change:

```ts
const extensions = computed(() => {
  const base = [
    StarterKit.configure({ codeBlock: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({ openOnClick: false }),
    Image,
    CodeBlockLowlight.configure({ lowlight }),
  ];
  const withEmbed = embedsEnabled.value ? [...base, CmsEmbed] : base;
  return cmsLinksEnabled.value ? [...withEmbed, CmsLink] : withEmbed;
});
```

to:

```ts
const extensions = computed(() => {
  const base = [
    StarterKit.configure({ codeBlock: false, link: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    ExternalLink,
    Image,
    CodeBlockLowlight.configure({ lowlight }),
  ];
  const withEmbed = embedsEnabled.value ? [...base, CmsEmbed] : base;
  return cmsLinksEnabled.value ? [...withEmbed, CmsLink] : withEmbed;
});
```

This drops `@tiptap/extension-link`, disables StarterKit's bundled `link` (which fixes the duplicate-extension warning we saw earlier), and adds our new `ExternalLink` node.

- [ ] **Step 5: Run typecheck + storybook tests**

```bash
pnpm typecheck
pnpm --filter cms test:storybook
```

Both expected to PASS. (Storybook story still mounts because the placeholder node views are valid empty Vue components; integration tests are unaffected by extension changes since they go through the validator we updated in Task 2.)

- [ ] **Step 6: Commit**

```bash
git add apps/cms/components/rich-text-editor/extensions/ apps/cms/components/rich-text-editor/CmsLinkNodeView.vue apps/cms/components/rich-text-editor/ExternalLinkNodeView.vue apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "refactor(rte): cmsLink mark→node, new externalLink node, drop stock Link (#115)"
```

---

### Task 5: LinkOptionsForm.vue (shared sub-component)

**Files:**

- Create: `apps/cms/components/link-options-form/LinkOptionsForm.vue`
- Create: `apps/cms/components/link-options-form/linkOptionsForm.config.ts`
- Create: `apps/cms/components/link-options-form/linkOptionsForm.types.ts`

- [ ] **Step 1: Create types file**

Create `apps/cms/components/link-options-form/linkOptionsForm.types.ts`:

```ts
import type { BasicComponentProps } from '../../types/basicComponentProps';

export type LinkOptions = {
  label: string;
  target: '_self' | '_blank' | null;
  rel: 'nofollow' | null;
};

export type LinkOptionsFormProps = BasicComponentProps & {
  modelValue: LinkOptions;
  labelPlaceholder?: string;
};
```

- [ ] **Step 2: Create config file**

Create `apps/cms/components/link-options-form/linkOptionsForm.config.ts`:

```ts
import { testIds } from '../../utils/test-config/testConfig.utils';

export const QA_LINK_OPTIONS_FORM = testIds('link-options-form', [
  'COMPONENT',
  'LABEL_INPUT',
  'TARGET_TOGGLE',
  'NOFOLLOW_TOGGLE',
] as const);
```

- [ ] **Step 3: Create the component**

Create `apps/cms/components/link-options-form/LinkOptionsForm.vue`:

```vue
<script setup lang="ts">
import type { LinkOptionsFormProps } from './linkOptionsForm.types';
import { QA_LINK_OPTIONS_FORM } from './linkOptionsForm.config';

const props = withDefaults(defineProps<LinkOptionsFormProps>(), {
  testId: QA_LINK_OPTIONS_FORM.COMPONENT,
  labelPlaceholder: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: LinkOptionsFormProps['modelValue']];
}>();

const label = computed({
  get: () => props.modelValue.label,
  set: (val: string) =>
    emit('update:modelValue', { ...props.modelValue, label: val }),
});

const newTab = computed({
  get: () => props.modelValue.target === '_blank',
  set: (val: boolean) =>
    emit('update:modelValue', {
      ...props.modelValue,
      target: val ? '_blank' : null,
    }),
});

const nofollow = computed({
  get: () => props.modelValue.rel === 'nofollow',
  set: (val: boolean) =>
    emit('update:modelValue', {
      ...props.modelValue,
      rel: val ? 'nofollow' : null,
    }),
});
</script>

<template>
  <div :data-testid="testId" class="space-y-3">
    <UFormField label="Display text">
      <UInput
        v-model="label"
        :placeholder="labelPlaceholder"
        class="w-full"
        :data-testid="QA_LINK_OPTIONS_FORM.LABEL_INPUT"
      />
    </UFormField>
    <USwitch
      v-model="newTab"
      label="Open in new tab"
      :data-testid="QA_LINK_OPTIONS_FORM.TARGET_TOGGLE"
    />
    <USwitch
      v-model="nofollow"
      label="Add nofollow"
      :data-testid="QA_LINK_OPTIONS_FORM.NOFOLLOW_TOGGLE"
    />
  </div>
</template>
```

- [ ] **Step 4: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Both expected to PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/link-options-form/
git commit -m "feat(rte): add LinkOptionsForm shared sub-component (#115)"
```

---

### Task 6: ExternalLinkModal.vue

**Files:**

- Create: `apps/cms/components/external-link-modal/ExternalLinkModal.vue`
- Create: `apps/cms/components/external-link-modal/externalLinkModal.config.ts`
- Create: `apps/cms/components/external-link-modal/externalLinkModal.types.ts`

- [ ] **Step 1: Create types**

Create `apps/cms/components/external-link-modal/externalLinkModal.types.ts`:

```ts
import type { BasicComponentProps } from '../../types/basicComponentProps';
import type { LinkOptions } from '../link-options-form/linkOptionsForm.types';

export type ExternalLinkSavePayload = {
  href: string;
} & LinkOptions;

export type ExternalLinkModalProps = BasicComponentProps & {
  open: boolean;
  initialHref?: string;
  initialOptions?: LinkOptions;
  mode: 'insert' | 'edit';
};
```

- [ ] **Step 2: Create config**

Create `apps/cms/components/external-link-modal/externalLinkModal.config.ts`:

```ts
import { testIds } from '../../utils/test-config/testConfig.utils';

export const QA_EXTERNAL_LINK_MODAL = testIds('external-link-modal', [
  'COMPONENT',
  'URL_INPUT',
  'SAVE_BTN',
  'REMOVE_BTN',
  'CANCEL_BTN',
] as const);
```

- [ ] **Step 3: Create the modal component**

Create `apps/cms/components/external-link-modal/ExternalLinkModal.vue`:

```vue
<script setup lang="ts">
import type {
  ExternalLinkModalProps,
  ExternalLinkSavePayload,
} from './externalLinkModal.types';
import type { LinkOptions } from '../link-options-form/linkOptionsForm.types';
import { QA_EXTERNAL_LINK_MODAL } from './externalLinkModal.config';

const props = withDefaults(defineProps<ExternalLinkModalProps>(), {
  testId: QA_EXTERNAL_LINK_MODAL.COMPONENT,
  initialHref: '',
  initialOptions: () => ({ label: '', target: null, rel: null }),
});

const emit = defineEmits<{
  save: [payload: ExternalLinkSavePayload];
  remove: [];
  close: [];
}>();

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

const href = ref(props.initialHref);
const options = ref<LinkOptions>({ ...props.initialOptions });

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      href.value = props.initialHref;
      options.value = { ...props.initialOptions };
    }
  }
);

const validation = computed<{ ok: boolean; message: string | null }>(() => {
  const trimmed = href.value.trim();
  if (trimmed === '') return { ok: false, message: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Enter a valid URL.' };
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return {
      ok: false,
      message: `Scheme '${parsed.protocol}' is not allowed.`,
    };
  }
  return { ok: true, message: null };
});

function onSave() {
  if (!validation.value.ok) return;
  emit('save', { href: href.value.trim(), ...options.value });
}
</script>

<template>
  <UModal
    :data-testid="testId"
    :open="open"
    @update:open="
      (val: boolean) => {
        if (!val) emit('close');
      }
    "
  >
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ mode === 'insert' ? 'Insert link' : 'Edit link' }}
      </h3>
    </template>

    <template #body>
      <div class="space-y-4">
        <UFormField label="URL" :error="validation.message ?? undefined">
          <UInput
            v-model="href"
            placeholder="https://example.com"
            class="w-full"
            :data-testid="QA_EXTERNAL_LINK_MODAL.URL_INPUT"
            @keyup.enter="onSave"
          />
        </UFormField>
        <LinkOptionsForm v-model="options" />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between gap-2 w-full">
        <UButton
          v-if="mode === 'edit'"
          color="error"
          variant="ghost"
          :data-testid="QA_EXTERNAL_LINK_MODAL.REMOVE_BTN"
          @click="emit('remove')"
        >
          Remove
        </UButton>
        <div class="flex gap-2 ml-auto">
          <UButton
            color="neutral"
            variant="ghost"
            :data-testid="QA_EXTERNAL_LINK_MODAL.CANCEL_BTN"
            @click="emit('close')"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :disabled="!validation.ok"
            :data-testid="QA_EXTERNAL_LINK_MODAL.SAVE_BTN"
            @click="onSave"
          >
            Save
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 4: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Both expected to PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/external-link-modal/
git commit -m "feat(rte): add ExternalLinkModal (#115)"
```

---

### Task 7: EntryPickerModal extension (mode + preselect + options + Save/Remove)

**Files:**

- Modify: `apps/cms/components/entry-picker-modal/EntryPickerModal.vue`
- Modify: `apps/cms/components/entry-picker-modal/entryPickerModal.types.ts`

- [ ] **Step 1: Update types**

In `apps/cms/components/entry-picker-modal/entryPickerModal.types.ts`, add the new prop fields:

```ts
import type { BasicComponentProps } from '../../types/basicComponentProps';
import type { LinkOptions } from '../link-options-form/linkOptionsForm.types';

export type EntryPickerMode = 'cmsEmbed' | 'cmsLink';

export type EntryPickerSelection = {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
};

export type EntryPickerUpdatePayload = EntryPickerSelection & LinkOptions;

export type EntryPickerModalProps = BasicComponentProps & {
  open: boolean;
  targetContentTypeIds: string[];
  mode?: EntryPickerMode;
  selectedEntry?: { contentTypeId: string; entryId: string } | null;
  initialOptions?: LinkOptions;
};
```

- [ ] **Step 2: Update `EntryPickerModal.vue` script section**

Open `apps/cms/components/entry-picker-modal/EntryPickerModal.vue`. Replace the `<script setup>` block:

```vue
<script setup lang="ts">
import type {
  EntryPickerModalProps,
  EntryPickerSelection,
  EntryPickerUpdatePayload,
} from './entryPickerModal.types';
import type { LinkOptions } from '../link-options-form/linkOptionsForm.types';
import { QA_ENTRY_PICKER_MODAL } from './entryPickerModal.config';

const props = withDefaults(defineProps<EntryPickerModalProps>(), {
  testId: QA_ENTRY_PICKER_MODAL.COMPONENT,
  mode: 'cmsEmbed',
  selectedEntry: null,
  initialOptions: () => ({ label: '', target: null, rel: null }),
});

const emit = defineEmits<{
  select: [data: EntryPickerSelection];
  update: [data: EntryPickerUpdatePayload];
  remove: [];
  create: [contentTypeId: string];
  close: [];
}>();

const isEditMode = computed(() => props.selectedEntry !== null);

const headerLabel = computed(() => {
  const action = isEditMode.value ? 'Edit' : 'Insert';
  const noun = props.mode === 'cmsLink' ? 'link' : 'embed';
  return `${action} ${noun}`;
});

// Fetch content type metadata for tabs
const { data: contentTypeOptions } = useAuthedFetch<
  { label: string; value: string }[]
>('/api/content-types/options');

const targetTypes = computed(() =>
  (contentTypeOptions.value ?? []).filter((o) =>
    props.targetContentTypeIds.includes(o.value)
  )
);

const activeTab = ref<string | null>(null);
const searchQuery = ref('');
const createPopoverOpen = ref(false);

// Currently highlighted entry (preselected on open in edit mode, or set by clicking a row in insert mode)
const highlightedEntryId = ref<string | null>(null);

// Link options state (only used in cmsLink mode)
const options = ref<LinkOptions>({ ...props.initialOptions });

// Reset state when modal opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      activeTab.value = null;
      searchQuery.value = '';
      createPopoverOpen.value = false;
      highlightedEntryId.value = props.selectedEntry?.entryId ?? null;
      options.value = { ...props.initialOptions };
    }
  }
);

// Fetch entries for each target type
const entries = ref<
  Array<{
    id: string;
    contentTypeId: string;
    contentTypeName: string;
    entryTitle: string;
  }>
>([]);

const isLoading = ref(false);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    isLoading.value = true;
    const results: typeof entries.value = [];

    for (const typeId of props.targetContentTypeIds) {
      const data = await $fetch<{
        items: Array<{ id: string; data: Record<string, unknown> }>;
      }>('/api/content-entries', {
        query: {
          contentTypeId: typeId,
          perPage: 100,
          archiveFilter: 'active',
        },
      });

      const typeName =
        targetTypes.value.find((t) => t.value === typeId)?.label ?? 'Unknown';

      const contentType = await $fetch<{
        fields: Array<{ identifier: string; type: string }>;
      }>(`/api/content-types/${typeId}`);
      const titleField = contentType.fields.find(
        (f) => f.type === 'ENTRY_TITLE'
      );
      const titleKey = titleField?.identifier ?? 'title';

      for (const item of data.items) {
        results.push({
          id: item.id,
          contentTypeId: typeId,
          contentTypeName: typeName,
          entryTitle: (item.data[titleKey] as string) ?? 'Untitled',
        });
      }
    }

    entries.value = results;
    isLoading.value = false;

    // Once loaded, scroll the highlighted row into view if any
    if (highlightedEntryId.value) {
      await nextTick();
      const el = document.querySelector(
        `[data-entry-id="${highlightedEntryId.value}"]`
      );
      el?.scrollIntoView({ block: 'nearest' });
    }
  },
  { immediate: true }
);

const filteredEntries = computed(() => {
  let list = entries.value;
  if (activeTab.value) {
    list = list.filter((e) => e.contentTypeId === activeTab.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((e) => e.entryTitle.toLowerCase().includes(q));
  }
  return list;
});

const highlightedEntry = computed(() =>
  entries.value.find((e) => e.id === highlightedEntryId.value)
);

function highlight(entry: { id: string }) {
  highlightedEntryId.value = entry.id;
}

function onSave() {
  const e = highlightedEntry.value;
  if (!e) return;
  if (isEditMode.value) {
    emit('update', {
      contentTypeId: e.contentTypeId,
      entryId: e.id,
      entryTitle: e.entryTitle,
      ...options.value,
    });
  } else if (props.mode === 'cmsLink') {
    // Insert with options
    emit('update', {
      contentTypeId: e.contentTypeId,
      entryId: e.id,
      entryTitle: e.entryTitle,
      ...options.value,
    });
  } else {
    emit('select', {
      contentTypeId: e.contentTypeId,
      entryId: e.id,
      entryTitle: e.entryTitle,
    });
  }
}

function handleCreate(contentTypeId: string) {
  createPopoverOpen.value = false;
  emit('create', contentTypeId);
}
</script>
```

- [ ] **Step 3: Update the template**

Replace the `<template>` section of the same file:

```vue
<template>
  <UModal
    :data-testid="testId"
    :open="open"
    @update:open="
      (val: boolean) => {
        if (!val) emit('close');
      }
    "
  >
    <template #header>
      <h3 class="text-lg font-semibold">{{ headerLabel }}</h3>
    </template>

    <template #body>
      <div class="space-y-4 -mt-2">
        <!-- Type tabs -->
        <div v-if="targetTypes.length > 1" class="flex gap-1 flex-wrap">
          <UButton
            size="xs"
            :variant="activeTab === null ? 'solid' : 'soft'"
            color="neutral"
            @click="activeTab = null"
          >
            All
          </UButton>
          <UButton
            v-for="t in targetTypes"
            :key="t.value"
            size="xs"
            :variant="activeTab === t.value ? 'solid' : 'soft'"
            color="neutral"
            @click="activeTab = t.value"
          >
            {{ t.label }}
          </UButton>
        </div>

        <!-- Search -->
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Search entries..."
          class="w-full"
        />

        <!-- Entry list -->
        <div v-if="isLoading" class="flex justify-center py-8">
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin size-6 text-muted"
          />
        </div>
        <div v-else class="max-h-72 overflow-y-auto -mx-2">
          <div
            v-for="entry in filteredEntries"
            :key="entry.id"
            :data-entry-id="entry.id"
            class="flex items-center h-12 px-3 mx-0 rounded-lg gap-3 cursor-pointer transition-colors"
            :class="
              entry.id === highlightedEntryId
                ? 'bg-primary-50 dark:bg-primary-950 ring-1 ring-primary'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            "
            @click="highlight(entry)"
          >
            <div
              class="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-700 shrink-0"
            >
              <span
                class="text-xs font-semibold text-gray-600 dark:text-gray-300"
              >
                {{ entry.contentTypeName.charAt(0).toUpperCase() }}
              </span>
            </div>
            <span class="text-sm font-medium flex-1 truncate">
              {{ entry.entryTitle }}
            </span>
            <span class="text-xs text-muted shrink-0">
              {{ entry.contentTypeName }}
            </span>
          </div>
          <p
            v-if="filteredEntries.length === 0 && !isLoading"
            class="text-sm text-muted text-center py-6"
          >
            No entries found
          </p>
        </div>

        <LinkOptionsForm
          v-if="mode === 'cmsLink'"
          v-model="options"
          :label-placeholder="highlightedEntry?.entryTitle ?? ''"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between gap-2 w-full">
        <UButton
          v-if="isEditMode"
          color="error"
          variant="ghost"
          @click="emit('remove')"
        >
          Remove
        </UButton>
        <div class="flex gap-2 ml-auto items-center">
          <div class="relative">
            <div
              v-if="createPopoverOpen && targetTypes.length > 1"
              class="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden z-10"
            >
              <div class="px-3 pt-2 pb-1">
                <span
                  class="text-xs font-medium text-muted uppercase tracking-wide"
                >
                  Create new
                </span>
              </div>
              <div
                v-for="t in targetTypes"
                :key="t.value"
                class="flex items-center h-10 px-3 gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                @click="handleCreate(t.value)"
              >
                <div
                  class="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-700 shrink-0"
                >
                  <span
                    class="text-xs font-semibold text-gray-600 dark:text-gray-300"
                  >
                    {{ t.label.charAt(0).toUpperCase() }}
                  </span>
                </div>
                <span class="text-sm font-medium">{{ t.label }}</span>
              </div>
            </div>
            <UButton
              variant="ghost"
              icon="i-lucide-plus"
              @click="
                targetTypes.length === 1
                  ? handleCreate(targetTypes[0]!.value)
                  : (createPopoverOpen = !createPopoverOpen)
              "
            >
              Create new...
            </UButton>
          </div>
          <UButton color="neutral" variant="ghost" @click="emit('close')">
            Cancel
          </UButton>
          <UButton
            color="primary"
            :disabled="!highlightedEntry"
            @click="onSave"
          >
            Save
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
```

Notes:

- The "Create new..." button no longer auto-emits `create` on row-click selection. Selection is decoupled from confirmation now (single-click highlights, Save confirms).
- The original `select` emit is preserved for backward compatibility with existing cmsEmbed insert flow if any other caller uses it without `mode='cmsLink'`. The new wiring in `RichTextEditor.vue` (Task 9) should rely on `update` everywhere going forward.

- [ ] **Step 4: Run typecheck + lint + storybook tests**

```bash
pnpm typecheck
pnpm lint
pnpm --filter cms test:storybook
```

All expected to PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/entry-picker-modal/
git commit -m "feat(rte): EntryPickerModal mode + preselect + LinkOptionsForm (#115)"
```

---

### Task 8: Chip node views + chip CSS

**Files:**

- Modify: `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue` (add label fallback + chip class + click-to-edit)
- Replace: `apps/cms/components/rich-text-editor/CmsLinkNodeView.vue` (the placeholder created in Task 4 → real component)
- Replace: `apps/cms/components/rich-text-editor/ExternalLinkNodeView.vue` (the placeholder created in Task 4 → real component)
- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (`<style scoped>` block — add `.rich-text-editor__chip` rules; revert Task 3 link-mark CSS at the same time)

- [ ] **Step 1: Define a shared chip-open-edit injection key**

Create `apps/cms/components/rich-text-editor/chipEdit.ts`:

```ts
import type { InjectionKey } from 'vue';

export type ChipEditPayload =
  | {
      kind: 'cmsEmbed' | 'cmsLink';
      pos: number;
      attrs: {
        contentTypeId: string;
        entryId: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | string | null;
      };
    }
  | {
      kind: 'externalLink';
      pos: number;
      attrs: {
        href: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | string | null;
      };
    };

export type ChipEditOpener = (payload: ChipEditPayload) => void;

export const CHIP_EDIT_KEY: InjectionKey<ChipEditOpener> = Symbol('chip-edit');
```

- [ ] **Step 2: Replace `CmsEmbedNodeView.vue`**

Read the current contents of `apps/cms/components/rich-text-editor/CmsEmbedNodeView.vue` first if you need to preserve any logic. Replace with:

```vue
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { useRelationResolver } from '../../composables/useRelationResolver';
import { CHIP_EDIT_KEY } from './chipEdit';

const props = defineProps<{
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number;
  selected: boolean;
}>();

const openEdit = inject(CHIP_EDIT_KEY);

const attrs = computed(() => props.node.attrs as Record<string, unknown>);
const contentTypeId = computed(
  () => attrs.value.contentTypeId as string | null
);
const entryId = computed(() => attrs.value.entryId as string | null);
const label = computed(() => (attrs.value.label as string | null) ?? null);

const { entryTitle, isLoading, isMissing } = useRelationResolver(
  computed(() =>
    contentTypeId.value && entryId.value
      ? { contentTypeId: contentTypeId.value, entryId: entryId.value }
      : null
  )
);

const display = computed(() => label.value || entryTitle.value || 'Untitled');

function onClick(event: MouseEvent) {
  event.stopPropagation();
  if (!contentTypeId.value || !entryId.value) return;
  props.editor.commands.setNodeSelection(props.getPos());
  openEdit?.({
    kind: 'cmsEmbed',
    pos: props.getPos(),
    attrs: {
      contentTypeId: contentTypeId.value,
      entryId: entryId.value,
      label: label.value,
    },
  });
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-editor__chip rich-text-editor__chip--embed"
    :class="{ 'rich-text-editor__chip--selected': selected }"
    @click="onClick"
  >
    <UIcon name="i-lucide-at-sign" class="rich-text-editor__chip-icon" />
    <span v-if="isLoading" class="rich-text-editor__chip-label"
      >Loading...</span
    >
    <span v-else-if="isMissing" class="rich-text-editor__chip-label">
      Missing entry
    </span>
    <span v-else class="rich-text-editor__chip-label">{{ display }}</span>
  </NodeViewWrapper>
</template>
```

If `useRelationResolver`'s actual return shape doesn't include `isLoading` / `isMissing` / `entryTitle` exactly as referenced, read the current `CmsEmbedNodeView.vue` (before this rewrite) to see what fields it consumes and use those names instead. Do not invent fields.

- [ ] **Step 3: Replace `CmsLinkNodeView.vue` placeholder with real component**

```vue
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { useRelationResolver } from '../../composables/useRelationResolver';
import { CHIP_EDIT_KEY } from './chipEdit';

const props = defineProps<{
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number;
  selected: boolean;
}>();

const openEdit = inject(CHIP_EDIT_KEY);

const attrs = computed(() => props.node.attrs as Record<string, unknown>);
const contentTypeId = computed(
  () => attrs.value.contentTypeId as string | null
);
const entryId = computed(() => attrs.value.entryId as string | null);
const label = computed(() => (attrs.value.label as string | null) ?? null);
const target = computed(
  () => (attrs.value.target as '_self' | '_blank' | null) ?? null
);
const rel = computed(() => (attrs.value.rel as string | null) ?? null);

const { entryTitle, isLoading, isMissing } = useRelationResolver(
  computed(() =>
    contentTypeId.value && entryId.value
      ? { contentTypeId: contentTypeId.value, entryId: entryId.value }
      : null
  )
);

const display = computed(() => label.value || entryTitle.value || 'Untitled');

function onClick(event: MouseEvent) {
  event.stopPropagation();
  if (!contentTypeId.value || !entryId.value) return;
  props.editor.commands.setNodeSelection(props.getPos());
  openEdit?.({
    kind: 'cmsLink',
    pos: props.getPos(),
    attrs: {
      contentTypeId: contentTypeId.value,
      entryId: entryId.value,
      label: label.value,
      target: target.value,
      rel: rel.value,
    },
  });
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-editor__chip rich-text-editor__chip--link"
    :class="{ 'rich-text-editor__chip--selected': selected }"
    @click="onClick"
  >
    <UIcon name="i-lucide-link-2" class="rich-text-editor__chip-icon" />
    <span v-if="isLoading" class="rich-text-editor__chip-label"
      >Loading...</span
    >
    <span v-else-if="isMissing" class="rich-text-editor__chip-label">
      Missing entry
    </span>
    <span v-else class="rich-text-editor__chip-label">{{ display }}</span>
  </NodeViewWrapper>
</template>
```

- [ ] **Step 4: Replace `ExternalLinkNodeView.vue` placeholder with real component**

```vue
<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { CHIP_EDIT_KEY } from './chipEdit';

const props = defineProps<{
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number;
  selected: boolean;
}>();

const openEdit = inject(CHIP_EDIT_KEY);

const attrs = computed(() => props.node.attrs as Record<string, unknown>);
const href = computed(() => (attrs.value.href as string) ?? '');
const label = computed(() => (attrs.value.label as string | null) ?? null);
const target = computed(
  () => (attrs.value.target as '_self' | '_blank' | null) ?? null
);
const rel = computed(() => (attrs.value.rel as string | null) ?? null);

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url;
  }
}

const display = computed(() => label.value || extractDomain(href.value));

function onClick(event: MouseEvent) {
  event.stopPropagation();
  props.editor.commands.setNodeSelection(props.getPos());
  openEdit?.({
    kind: 'externalLink',
    pos: props.getPos(),
    attrs: {
      href: href.value,
      label: label.value,
      target: target.value,
      rel: rel.value,
    },
  });
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-editor__chip rich-text-editor__chip--external"
    :class="{ 'rich-text-editor__chip--selected': selected }"
    @click="onClick"
  >
    <UIcon name="i-lucide-external-link" class="rich-text-editor__chip-icon" />
    <span class="rich-text-editor__chip-label">{{ display }}</span>
  </NodeViewWrapper>
</template>
```

- [ ] **Step 5: Add chip CSS to `RichTextEditor.vue` `<style scoped>` block; revert Task 3's link-mark CSS**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`, find the `<style scoped>` block. The block currently contains (a) the typography rules from Task 2, and (b) the link styling from Task 3.

Remove the Task 3 rules:

```css
.rich-text-editor__content :deep(.ProseMirror a) {
  @apply text-primary underline;
}
.rich-text-editor__content :deep(.ProseMirror a.cms-link)::before {
  --cms-link-icon: url(...);
  ...
}
```

Add chip rules in their place (still inside the same `<style scoped>` block, before the closing `</style>`):

```css
.rich-text-editor__content :deep(.rich-text-editor__chip) {
  @apply inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md text-sm cursor-pointer transition-colors;
  background-color: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.rich-text-editor__content :deep(.rich-text-editor__chip:hover) {
  background-color: rgba(0, 0, 0, 0.08);
}
.rich-text-editor__content :deep(.rich-text-editor__chip--selected) {
  @apply ring-2 ring-primary ring-offset-1;
}
.rich-text-editor__content :deep(.rich-text-editor__chip-icon) {
  @apply size-3.5 shrink-0;
}
.rich-text-editor__content :deep(.rich-text-editor__chip-label) {
  @apply truncate max-w-xs;
}
.rich-text-editor__content
  :deep(.rich-text-editor__chip--embed .rich-text-editor__chip-icon),
.rich-text-editor__content
  :deep(.rich-text-editor__chip--link .rich-text-editor__chip-icon) {
  @apply text-primary;
}
.rich-text-editor__content
  :deep(.rich-text-editor__chip--external .rich-text-editor__chip-icon) {
  @apply text-amber-600 dark:text-amber-400;
}
```

(The dark variant of the chip background can be added if eyeballing reveals contrast issues — leave the simple rules above first and refine in manual verification.)

- [ ] **Step 6: Run typecheck + lint + storybook tests**

```bash
pnpm typecheck
pnpm lint
pnpm --filter cms test:storybook
```

The storybook test will fail because the AllStyledNodes story's sample doc still uses the old shapes (cmsLink mark, plain external link mark). That migration happens in Task 11 — so for this commit, the story may show "Missing entry" or warnings but should not crash. If it crashes (uncaught exception), STOP and investigate before proceeding.

If storybook test passes but the rendered chips are visually wrong, that's expected at this point — Task 11 will refresh the story.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/components/rich-text-editor/
git commit -m "feat(rte): chip node views + revert Task 3 link-mark CSS (#115)"
```

---

### Task 9: Editor orchestration — modal state, toolbar wiring, chip-click handlers, link button reverts

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (script + template)

- [ ] **Step 1: Update `<script setup>` — drop old picker state, wire modal state per chip type**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`, locate the existing handler functions (`promptLink`, `openEmbedPicker`, `handleEmbedSelect`, `openCmsLinkPicker`, `handleCmsLinkSelect`) and the picker `ref`s (`pickerOpen`, `linkPickerOpen`).

Replace with the unified state below. Add the imports + the new handler set immediately after the existing extension imports + computed `extensions`:

```ts
import { CHIP_EDIT_KEY } from './chipEdit';
import type { ChipEditPayload } from './chipEdit';
import type {
  EntryPickerSelection,
  EntryPickerUpdatePayload,
} from '../entry-picker-modal/entryPickerModal.types';
import type {
  ExternalLinkSavePayload,
  ExternalLinkModalProps,
} from '../external-link-modal/externalLinkModal.types';
import type { LinkOptions } from '../link-options-form/linkOptionsForm.types';

type EntryPickerState = {
  open: boolean;
  mode: 'cmsEmbed' | 'cmsLink';
  selectedEntry: { contentTypeId: string; entryId: string } | null;
  initialOptions: LinkOptions;
  pos: number | null; // null = inserting; non-null = editing existing chip
};

type ExternalLinkState = {
  open: boolean;
  mode: 'insert' | 'edit';
  initialHref: string;
  initialOptions: LinkOptions;
  pos: number | null;
};

const entryPickerState = ref<EntryPickerState>({
  open: false,
  mode: 'cmsEmbed',
  selectedEntry: null,
  initialOptions: { label: '', target: null, rel: null },
  pos: null,
});

const externalLinkState = ref<ExternalLinkState>({
  open: false,
  mode: 'insert',
  initialHref: '',
  initialOptions: { label: '', target: null, rel: null },
  pos: null,
});

function openInsertEmbed() {
  entryPickerState.value = {
    open: true,
    mode: 'cmsEmbed',
    selectedEntry: null,
    initialOptions: { label: '', target: null, rel: null },
    pos: null,
  };
}

function openInsertCmsLink() {
  entryPickerState.value = {
    open: true,
    mode: 'cmsLink',
    selectedEntry: null,
    initialOptions: { label: '', target: null, rel: null },
    pos: null,
  };
}

function openInsertExternalLink() {
  externalLinkState.value = {
    open: true,
    mode: 'insert',
    initialHref: '',
    initialOptions: { label: '', target: null, rel: null },
    pos: null,
  };
}

function openEditChip(payload: ChipEditPayload) {
  if (payload.kind === 'externalLink') {
    externalLinkState.value = {
      open: true,
      mode: 'edit',
      initialHref: payload.attrs.href,
      initialOptions: {
        label: payload.attrs.label ?? '',
        target: payload.attrs.target ?? null,
        rel: payload.attrs.rel === 'nofollow' ? 'nofollow' : null,
      },
      pos: payload.pos,
    };
    return;
  }
  entryPickerState.value = {
    open: true,
    mode: payload.kind,
    selectedEntry: {
      contentTypeId: payload.attrs.contentTypeId,
      entryId: payload.attrs.entryId,
    },
    initialOptions: {
      label: payload.attrs.label ?? '',
      target: payload.attrs.target ?? null,
      rel: payload.attrs.rel === 'nofollow' ? 'nofollow' : null,
    },
    pos: payload.pos,
  };
}

provide(CHIP_EDIT_KEY, openEditChip);

function handleEntryPickerInsert(data: EntryPickerSelection) {
  // cmsEmbed insert (no link options)
  if (!editor.value) return;
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'cmsEmbed',
      attrs: { contentTypeId: data.contentTypeId, entryId: data.entryId },
    })
    .run();
  entryPickerState.value.open = false;
}

function handleEntryPickerSave(data: EntryPickerUpdatePayload) {
  if (!editor.value) return;
  const state = entryPickerState.value;
  const isEdit = state.pos !== null;
  const nodeType = state.mode;
  const attrs: Record<string, unknown> = {
    contentTypeId: data.contentTypeId,
    entryId: data.entryId,
  };
  if (nodeType === 'cmsLink') {
    if (data.label) attrs.label = data.label;
    if (data.target) attrs.target = data.target;
    if (data.rel) attrs.rel = data.rel;
  } else {
    if (data.label) attrs.label = data.label;
  }
  if (isEdit && state.pos !== null) {
    const pos = state.pos;
    editor.value
      .chain()
      .focus()
      .setNodeSelection(pos)
      .deleteSelection()
      .insertContentAt(pos, { type: nodeType, attrs })
      .run();
  } else {
    editor.value.chain().focus().insertContent({ type: nodeType, attrs }).run();
  }
  entryPickerState.value.open = false;
}

function handleEntryPickerRemove() {
  if (!editor.value) return;
  const state = entryPickerState.value;
  if (state.pos !== null) {
    editor.value
      .chain()
      .focus()
      .setNodeSelection(state.pos)
      .deleteSelection()
      .run();
  }
  entryPickerState.value.open = false;
}

function handleExternalLinkSave(data: ExternalLinkSavePayload) {
  if (!editor.value) return;
  const state = externalLinkState.value;
  const attrs: Record<string, unknown> = { href: data.href };
  if (data.label) attrs.label = data.label;
  if (data.target) attrs.target = data.target;
  if (data.rel) attrs.rel = data.rel;
  if (state.pos !== null) {
    const pos = state.pos;
    editor.value
      .chain()
      .focus()
      .setNodeSelection(pos)
      .deleteSelection()
      .insertContentAt(pos, { type: 'externalLink', attrs })
      .run();
  } else {
    editor.value
      .chain()
      .focus()
      .insertContent({ type: 'externalLink', attrs })
      .run();
  }
  externalLinkState.value.open = false;
}

function handleExternalLinkRemove() {
  if (!editor.value) return;
  const state = externalLinkState.value;
  if (state.pos !== null) {
    editor.value
      .chain()
      .focus()
      .setNodeSelection(state.pos)
      .deleteSelection()
      .run();
  }
  externalLinkState.value.open = false;
}
```

Delete the now-unused old handlers and refs: `pickerOpen`, `linkPickerOpen`, `promptLink`, `openEmbedPicker`, `handleEmbedSelect`, `openCmsLinkPicker`, `handleCmsLinkSelect`, plus the import of `useToast` if it was only used by `openCmsLinkPicker`.

- [ ] **Step 2: Update toolbar buttons + modal mounts in `<template>`**

For the three toolbar buttons that open modals:

External link button (currently around l.221):

```vue
<UButton
  variant="ghost"
  size="xs"
  icon="i-lucide-link"
  color="neutral"
  @click="openInsertExternalLink"
/>
```

Embed `@` button:

```vue
<UButton
  v-if="embedsEnabled"
  variant="ghost"
  size="xs"
  icon="i-lucide-at-sign"
  color="neutral"
  :data-testid="QA_RICH_TEXT_EDITOR.EMBED_BTN"
  aria-label="Insert inline embed"
  @click="openInsertEmbed"
/>
```

cmsLink button:

```vue
<UButton
  v-if="cmsLinksEnabled"
  variant="ghost"
  size="xs"
  icon="i-lucide-link-2"
  color="neutral"
  :data-testid="QA_RICH_TEXT_EDITOR.CMS_LINK_BTN"
  aria-label="Insert entry link"
  @click="openInsertCmsLink"
/>
```

Note: all three have static `color="neutral"` (the Task 4 `:color` ternary on the external-link button reverts; the cmsLink button's pre-existing `editor?.isActive('cmsLink') ? 'primary' : 'neutral'` reverts).

Replace the two existing `EntryPickerModal` instances at the bottom of the template with a single instance that consumes `entryPickerState`, plus a new `ExternalLinkModal`:

```vue
<EntryPickerModal
  v-if="entryPickerState.open"
  :open="entryPickerState.open"
  :target-content-type-ids="
    entryPickerState.mode === 'cmsEmbed'
      ? targetContentTypeIds
      : linkTargetContentTypeIds
  "
  :mode="entryPickerState.mode"
  :selected-entry="entryPickerState.selectedEntry"
  :initial-options="entryPickerState.initialOptions"
  @select="handleEntryPickerInsert"
  @update="handleEntryPickerSave"
  @remove="handleEntryPickerRemove"
  @close="entryPickerState.open = false"
/>

<ExternalLinkModal
  v-if="externalLinkState.open"
  :open="externalLinkState.open"
  :mode="externalLinkState.mode"
  :initial-href="externalLinkState.initialHref"
  :initial-options="externalLinkState.initialOptions"
  @save="handleExternalLinkSave"
  @remove="handleExternalLinkRemove"
  @close="externalLinkState.open = false"
/>
```

- [ ] **Step 3: Run typecheck + lint + storybook tests**

```bash
pnpm typecheck
pnpm lint
pnpm --filter cms test:storybook
```

The storybook story still references the old node shapes — expect possible rendering oddities until Task 11. Tests should still PASS (story mounts even if rendering is half-migrated).

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "feat(rte): wire chip insert + edit modals, revert link-mark toolbar bindings (#115)"
```

---

### Task 10: Focus outline fixes

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue` (template + style)

- [ ] **Step 1: Move `p-4` from `<EditorContent>` into the editable root**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue` template, find:

```vue
<EditorContent
  :editor="editor"
  class="rich-text-editor__content p-4 min-h-[200px]"
/>
```

Replace with:

```vue
<EditorContent
  :editor="editor"
  class="rich-text-editor__content min-h-[200px]"
/>
```

In the `<style scoped>` block, append after the existing typography + chip rules (before `</style>`):

```css
.rich-text-editor__content :deep(.ProseMirror) {
  @apply p-4;
  outline: none;
}
.rich-text-editor__content :deep(.ProseMirror:focus-visible) {
  @apply ring-2 ring-primary ring-inset rounded;
}
.rich-text-editor__content :deep(.ProseMirror h1:first-child),
.rich-text-editor__content :deep(.ProseMirror h2:first-child),
.rich-text-editor__content :deep(.ProseMirror h3:first-child),
.rich-text-editor__content :deep(.ProseMirror p:first-child) {
  @apply mt-0;
}
```

Notes:

- `outline: none` on `.ProseMirror` removes the user-agent default focus outline.
- `:focus-visible` adds a primary-coloured inset ring that doesn't intersect content because it's inset and bounded by the padding.
- `:first-child { @apply mt-0 }` removes leading whitespace on the first block element so the inset ring doesn't crowd against the H1's `mt-6`.

- [ ] **Step 2: Run storybook tests**

```bash
pnpm --filter cms test:storybook
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.vue
git commit -m "fix(rte): inset focus ring + suppress first-child top margin (#115)"
```

---

### Task 11: Storybook story sample doc update

**Files:**

- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`

- [ ] **Step 1: Update sample doc to nodes-only shape**

Open `apps/cms/components/rich-text-editor/RichTextEditor.stories.ts`. Locate the paragraph fragment that currently includes the external link mark and the cmsLink mark:

```ts
{
  type: 'paragraph',
  content: [
    { type: 'text', text: 'A paragraph with an ' },
    {
      type: 'text',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      text: 'external URL link',
    },
    { type: 'text', text: ' and a ' },
    {
      type: 'text',
      marks: [
        {
          type: 'cmsLink',
          attrs: {
            contentTypeId: 'ct-author',
            entryId: 'a1',
            contentTypeIdentifier: 'Author',
          },
        },
      ],
      text: 'CMS entry link',
    },
    { type: 'text', text: '.' },
  ],
}
```

Replace with the chip-node shape:

```ts
{
  type: 'paragraph',
  content: [
    { type: 'text', text: 'A paragraph with an ' },
    {
      type: 'externalLink',
      attrs: { href: 'https://example.com' },
    },
    { type: 'text', text: ' and a ' },
    {
      type: 'cmsLink',
      attrs: {
        contentTypeId: 'ct-author',
        entryId: 'a1',
        contentTypeIdentifier: 'Author',
      },
    },
    { type: 'text', text: '.' },
  ],
}
```

Add a new paragraph below the existing ones to show a cmsEmbed chip side by side:

```ts
{
  type: 'paragraph',
  content: [
    { type: 'text', text: 'And here is an embed: ' },
    {
      type: 'cmsEmbed',
      attrs: {
        contentTypeId: 'ct-author',
        entryId: 'a1',
        contentTypeIdentifier: 'Author',
      },
    },
    { type: 'text', text: '.' },
  ],
},
```

- [ ] **Step 2: Run storybook tests**

```bash
pnpm --filter cms test:storybook
```

Expected: PASS for `AllStyledNodes`. The story doesn't have a `play` function so it's a smoke test — confirm no console errors / unhandled exceptions.

- [ ] **Step 3: Optionally eyeball in storybook dev**

```bash
pnpm --filter cms storybook
```

Open `http://localhost:6006`, navigate to `Components/RichTextEditor → AllStyledNodes`. Confirm:

- All three chip types render (cmsEmbed, cmsLink, externalLink) with correct icons.
- Headings, lists, blockquote, code render correctly.
- No console errors.

(Resolver-driven chips will likely show "Missing entry" since there is no MSW for `/api/content-entries/a1` — that's expected and confirms the missing-entry fallback works.)

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/rich-text-editor/RichTextEditor.stories.ts
git commit -m "test(rte): migrate AllStyledNodes story to nodes-only shape (#115)"
```

---

### Task 12: Final verification + push + open PR + open follow-up issue

**Files:** none

- [ ] **Step 1: Run the full suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter cms test:storybook
```

All four expected to PASS.

- [ ] **Step 2: Manual smoke test in `pnpm dev`**

Run: `pnpm dev` (in another terminal)

Walk through every item on this checklist:

- [ ] Open an entry with a RICHTEXT field that has both `targetContentTypeIds` (embeds) and `linkTargetContentTypeIds` (cmsLinks) set.
- [ ] Toolbar `@` button → entry picker opens in cmsEmbed mode with no preselect; pick → embed chip inserted at cursor.
- [ ] Click the cmsEmbed chip → entry picker reopens with the chip's entry highlighted; `Save` confirms; `Remove` deletes the chip.
- [ ] Toolbar chain (cmsLink) button → entry picker opens in cmsLink mode with `LinkOptionsForm` visible; set Display text + toggle "Open in new tab" + toggle "Add nofollow"; `Save` inserts a cmsLink chip showing the entered display text.
- [ ] Click the cmsLink chip → modal reopens with current attrs preloaded; change attrs; `Save` replaces in place.
- [ ] Toolbar external-link button → ExternalLinkModal opens; enter `https://example.com`, set toggles, save → external-link chip inserted.
- [ ] Click external-link chip → modal reopens; change href / toggles → save replaces in place; `Remove` deletes.
- [ ] Try an invalid URL (`javascript:foo`) in the external-link modal — Save button stays disabled; error message visible.
- [ ] Verify the focus outline does NOT cut into the cursor when at line start.
- [ ] Verify the focus outline does NOT cut into H1 margin when H1 is at the top.
- [ ] Verify Backspace on a selected chip (any kind) deletes it.
- [ ] Verify all three toolbar buttons (`@`, chain, external link) render in the same neutral grey at rest.
- [ ] Save the entry → reload → verify the body persists with chips intact.

If any item fails, fix and re-run before pushing.

- [ ] **Step 3: Wallaby check**

Use the `wallaby_failingTests` MCP tool. Three outcomes per `CLAUDE.md`:

- Empty failures array → `WALLABY_VERIFIED=1` on the push.
- Failures present → fix and re-run before pushing.
- Wallaby unavailable → plain `git push` (the pre-push hook runs the full suite).

- [ ] **Step 4: Push**

If Wallaby returned no failures:

```bash
WALLABY_VERIFIED=1 git push -u origin fix/rte-editor-presentation
```

Otherwise:

```bash
git push -u origin fix/rte-editor-presentation
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(rte): editor chip redesign + link target/rel + focus outline (#115)" --body "$(cat <<'EOF'
## Summary

Closes #115. Squash-merge this branch.

This PR addresses six surface bugs and one interaction-model change in the rich text editor, all flagged on issue #115:

- Headings rendered flat (no \`prose\` plugin) → hand-rolled scoped typography.
- \`cmsLink\` marks invisible → \`cmsLink\` is now an inline atom-node chip with chain icon.
- External \`Link\` marks invisible → \`externalLink\` is now an inline atom-node chip with leaving-site icon.
- Three toolbar buttons rendering permanently green (table / external link / embed \`@\`) → static \`color="neutral"\` on insert-only buttons.
- Focus outline obscured the cursor at line start → outline moved inset, padding moved into the editable root.
- Focus outline cut through H1 leading margin → first-child top-margin reset to zero.
- "Select text + click toolbar to wrap" workflow → removed entirely. Toolbar buttons are insert-only; clicking any chip opens its edit modal.

Both link node types now support \`label\`, \`target\` (\`_self\` / \`_blank\`), and \`rel\` (\`nofollow\`). Server stamps \`noopener noreferrer\` defensively whenever \`target='_blank'\`.

## Schema change (pre-release)

\`cmsLink\` was a Tiptap mark in PR #119 (merged days ago, not yet shipped past 0.0.1-rc.1). This PR makes it an inline atom node — a clean schema swap with no migration shim, since no fixtures, starter bundles, or production data reference the mark shape.

External GraphQL consumers see the same \`RichText { json, references }\` interface; only the JSON shape inside \`json\` changes (cmsLink moves out of \`text.marks\` into its own node; \`externalLink\` replaces the stock \`link\` mark).

Specs: \`docs/superpowers/specs/2026-04-29-rte-editor-presentation-fixes-design.md\` and \`docs/superpowers/specs/2026-04-29-rte-chip-redesign-design.md\` (the latter supersedes parts of the former).

Plan: \`docs/superpowers/plans/2026-04-29-rte-chip-redesign.md\`.

## Test plan

- [ ] All three chip types insert via toolbar with correct modals
- [ ] Clicking each chip type opens the modal preloaded with attrs
- [ ] Save replaces in place; Remove deletes
- [ ] EntryPickerModal preselect highlights matching row + scrolls into view
- [ ] LinkOptionsForm fields persist correctly through save → reload round-trip
- [ ] \`javascript:\` URLs rejected in ExternalLinkModal and server validator
- [ ] \`mailto:\` and \`tel:\` URLs accepted
- [ ] \`target='_blank'\` causes server to stamp \`rel='noopener noreferrer'\`
- [ ] \`target='_blank'\` + \`rel='nofollow'\` produces \`rel='nofollow noopener noreferrer'\`
- [ ] Focus outline is inset and does not crowd cursor or H1 margin
- [ ] Backspace on a selected chip deletes the chip
- [ ] All toolbar buttons render neutral grey at rest
- [ ] Mark-buttons (B / I / H1-3 / lists / blockquote / code) still flip primary when active
- [ ] \`pnpm lint\` / \`pnpm typecheck\` / \`pnpm test\` / \`pnpm --filter cms test:storybook\` all green

## Follow-up

A separate issue tracks Storybook MSW + Nuxt auto-import shim plumbing so future RTE stories can cover chip-click-to-edit interaction flows. See the new GH issue (linked when opened).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Open the follow-up issue**

After the PR is created, open the MSW + auto-import shim follow-up:

```bash
gh issue create --title "Storybook plumbing: MSW handler fixtures + Nuxt auto-import shims" --body "$(cat <<'EOF'
Storybook stories that exercise our auth-gated APIs (\`/api/content-entries\`, \`/api/content-types\`, \`/api/content-types/options\`) or Nuxt-auto-imported composables (\`useAuthedFetch\`, \`useRequestFetch\`, \`useToast\`, \`navigateTo\`) currently can't be written without per-story plumbing that is not set up.

\`apps/cms/.storybook/README.md\` flags this gap explicitly: "Nuxt-auto-imported helpers (\`useAuthedFetch\`, \`$fetch\`, \`useToast\`, \`navigateTo\`, etc.) that appear as globals in components — consider extending Nuxt UI's bundled \`unplugin-auto-import\` via its \`autoImport.dirs\` option (see \`main.ts\`) and pointing it at a Storybook-only shims directory. Not set up today — components using these auto-imports need a per-story workaround until that plumbing lands."

## Scope

- Add MSW handler fixtures in \`apps/cms/.storybook/mocks/handlers.ts\` for:
  - \`GET /api/content-entries?contentTypeId=...\`
  - \`GET /api/content-types/options\`
  - \`GET /api/content-types/:id\`
- Configure \`unplugin-auto-import\` (via Nuxt UI's bundled instance) to point at \`apps/cms/.storybook/shims/\` for Nuxt-only auto-imports.
- Add shim files for: \`useAuthedFetch\`, \`useRequestFetch\`, \`useToast\`, \`navigateTo\`, \`useRequestHeaders\`.
- Update \`.storybook/README.md\` to remove the "not set up today" caveat.

## Why now

Came up while building chip-click-to-edit interaction tests for the rich text editor in #115. We deferred those interaction stories to keep #115 focused; they should land once this plumbing is available.

Reference: #115
EOF
)"
```

Note the new issue number for any future cross-references.

---

## Self-Review

**1. Spec coverage:**

Walking the spec section-by-section:

| Spec section                        | Plan tasks                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| §1 Tiptap extensions                | Task 4 (CmsEmbed label, CmsLink rewrite, ExternalLink new, RichTextEditor extensions array)     |
| §2 Vue node-view chip components    | Task 8 (all three node views + chip CSS)                                                        |
| §3 Edit modals                      | Tasks 5 (LinkOptionsForm), 6 (ExternalLinkModal), 7 (EntryPickerModal extension)                |
| §4 Toolbar interaction model        | Task 9 (orchestration: toolbar wiring, chip-click signal, modal handlers, link button reverts)  |
| §5 Server-side validators + walkers | Tasks 1 (collect + enrich + rel injection) and 2 (validator + externalLink + scheme allow-list) |
| §6 GraphQL surface                  | Tasks 1, 2, 3 cover everything (no Pothos schema changes; only fixture shapes in tests)         |
| §7 Focus outline fixes              | Task 10                                                                                         |
| Storybook story update              | Task 11                                                                                         |
| Final verification + PR + follow-up | Task 12                                                                                         |
| Migration of existing branch state  | Tasks 8 (revert Task 3 link-mark CSS) and 9 (revert Task 4 link button isActive bindings)       |
| Out-of-scope items                  | Honoured — not implemented anywhere.                                                            |
| Follow-ups                          | Task 12 Step 6 opens the MSW/auto-import-shim issue.                                            |

No spec gaps.

**2. Placeholder scan:**

No "TBD" / "TODO" / "fill in details" / "implement later" / "similar to Task N" / "add appropriate validation" patterns. Every code step shows complete code; every command step shows the exact invocation and expected outcome.

The only step with a small judgement call is Task 8 Step 2, where the implementer is told to read the current `useRelationResolver` return shape if the assumed names don't match. That's a deliberate guard against my guessing wrong names — not a placeholder.

**3. Type consistency:**

- `LinkOptions` is defined in Task 5 (`linkOptionsForm.types.ts`) and consumed identically in Tasks 6, 7, 9.
- `ChipEditPayload` defined in Task 8 (`chipEdit.ts`) consumed in Task 9.
- `EntryPickerSelection` / `EntryPickerUpdatePayload` defined in Task 7 (`entryPickerModal.types.ts`) consumed in Task 9.
- `ExternalLinkSavePayload` / `ExternalLinkModalProps` defined in Task 6 consumed in Task 9.
- The cmsLink Tiptap node's `addCommands` exposes `insertCmsLink` (Task 4); Task 9 actually invokes the chain via `.insertContent({ type: nodeType, attrs })` rather than via the typed command — the typed command is provided for any future caller that wants the type safety.
- All Tiptap node names (`cmsEmbed`, `cmsLink`, `externalLink`) are consistent across extensions, validators, walkers, and node views.
- All test ID constants follow the same pattern: kebab-case file → `QA_<UPPER_SNAKE>` export.
- Mode strings (`'cmsEmbed'` / `'cmsLink'` / `'cmsLink' | 'cmsEmbed'`) are consistent across `EntryPickerModal`, `ChipEditPayload`, and orchestration handlers.
- Target value (`'_self' | '_blank' | null`) consistent across types, modal forms, validator, and rel injection logic.
- Rel value (`'nofollow' | null` user-toggleable, server may extend to `'nofollow noopener noreferrer'`) consistent across editor and server.

No type mismatches.
