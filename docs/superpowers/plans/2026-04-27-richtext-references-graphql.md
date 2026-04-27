# RichText GraphQL with embedded + linked entries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-`JSON` GraphQL exposure of RICHTEXT fields with a `RichText { json, references }` object type, and add an entry-targeted hyperlink primitive (`cmsLink` Tiptap mark) whose targets feed the same `references` array.

**Architecture:** A shared Pothos object type `RichText` is registered once in `dynamicTypes.ts` and reused for every RICHTEXT field. Its `references` resolver walks the ProseMirror document, harvests `(contentTypeId, entryId)` pairs from `cmsEmbed` nodes and `cmsLink` marks (combined, deduplicated), and runs one batched `findMany` filtered to PUBLISHED versions. The result resolves to the existing `ContentEntry` interface so consumers spread per-type fragments. A new Tiptap mark `cmsLink` lives alongside the existing external-URL `Link`. RICHTEXT field options gain a sibling `linkTargetContentTypeIds` allow-list (independent of the embed allow-list). Validator and identifier-stamp enrichment extend to also visit text-node marks. **Spec:** `docs/superpowers/specs/2026-04-27-richtext-references-graphql-design.md`.

**Tech Stack:** Nuxt 4 + Nitro, Pothos GraphQL builder + `@pothos/plugin-relay`, Prisma v7 (PostgreSQL), Tiptap (@tiptap/vue-3), Vitest (unit + integration projects).

---

## File Structure

**Create:**

- `apps/cms/server/utils/collectRichtextReferences.ts` — walker returning `[{ contentTypeId, entryId }]` deduped pairs.
- `apps/cms/server/utils/collectRichtextReferences.test.ts` — unit tests for the walker.
- `apps/cms/components/rich-text-editor/extensions/CmsLink.ts` — Tiptap mark for entry-link.

**Modify:**

- `apps/cms/server/utils/enrichRichtextEmbeds.ts` — extend recursion to also collect/stamp on `cmsLink` marks.
- `apps/cms/server/utils/enrichRichtextEmbeds.test.ts` — add cmsLink test coverage.
- `apps/cms/server/utils/validateEntryData.ts` — accept `linkTargetContentTypeIds` option, walk marks, reject out-of-allow-list `cmsLink` marks.
- `apps/cms/server/utils/validateEntryData.test.ts` — add cmsLink validation cases.
- `apps/cms/server/graphql/dynamicTypes.ts` — remove `RICHTEXT` from `FIELD_TYPE_TO_SCALAR`; register shared `RichText` objectRef + per-field resolver.
- `apps/cms/server/api/graphql/graphql.test.ts` — add richtext integration test covering `body { json references }`.
- `apps/cms/components/rich-text-editor/RichTextEditor.vue` — add `linkTargetContentTypeIds` prop, conditional `CmsLink` registration, new toolbar button, picker handler.
- `apps/cms/components/rich-text-editor/richTextEditor.types.ts` — add `linkTargetContentTypeIds?: string[]`.
- `apps/cms/components/rich-text-editor/richTextEditor.config.ts` — add `LINK_BTN` test id.
- `apps/cms/types/contentEditor.ts` — add `linkTargetContentTypeIds?: string[]` to `RichtextFieldConfig`.
- `apps/cms/utils/mapFieldToConfig.ts` — read `linkTargetContentTypeIds` from RICHTEXT options.
- `apps/cms/components/content-editor/ContentEditor.vue` — pass prop through.
- `apps/cms/pages/content-types/new.vue` — add second `ContentTypeChipPicker` for link targets.
- `apps/cms/pages/content-types/[id]/index.vue` — same as above.

---

## Task 1: Walker — `collectRichtextReferences`

**Files:**

- Create: `apps/cms/server/utils/collectRichtextReferences.ts`
- Test: `apps/cms/server/utils/collectRichtextReferences.test.ts`

**Why first:** Pure function with no dependencies. Used by both the GraphQL `references` resolver (Task 4) and downstream — building it first gives us deterministic test coverage without needing a running server.

- [ ] **Step 1: Write failing test file**

Create `apps/cms/server/utils/collectRichtextReferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectRichtextReferences } from './collectRichtextReferences';

const doc = (content: unknown[]) => ({ type: 'doc', content });
const para = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const embed = (contentTypeId: string, entryId: string) => ({
  type: 'cmsEmbed',
  attrs: { contentTypeId, entryId },
});
const cmsLinkMark = (contentTypeId: string, entryId: string) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId },
});
const externalLinkMark = (href: string) => ({ type: 'link', attrs: { href } });
const blockquote = (content: unknown[]) => ({ type: 'blockquote', content });
const bulletList = (items: unknown[][]) => ({
  type: 'bulletList',
  content: items.map((c) => ({ type: 'listItem', content: c })),
});

describe('collectRichtextReferences', () => {
  it('returns empty array for body with no references', () => {
    expect(collectRichtextReferences(doc([para([text('plain')])]))).toEqual([]);
  });

  it('handles null / undefined / non-object input', () => {
    expect(collectRichtextReferences(null)).toEqual([]);
    expect(collectRichtextReferences(undefined)).toEqual([]);
    expect(collectRichtextReferences('string')).toEqual([]);
  });

  it('collects a single cmsEmbed reference', () => {
    expect(
      collectRichtextReferences(doc([para([embed('ct-1', 'e-1')])]))
    ).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('collects a single cmsLink mark reference', () => {
    expect(
      collectRichtextReferences(
        doc([para([text('Click', [cmsLinkMark('ct-2', 'e-2')])])])
      )
    ).toEqual([{ contentTypeId: 'ct-2', entryId: 'e-2' }]);
  });

  it('ignores external link marks', () => {
    expect(
      collectRichtextReferences(
        doc([para([text('Click', [externalLinkMark('https://x.test')])])])
      )
    ).toEqual([]);
  });

  it('deduplicates the same (contentTypeId, entryId) appearing multiple times', () => {
    const refs = collectRichtextReferences(
      doc([
        para([embed('ct-1', 'e-1'), embed('ct-1', 'e-1')]),
        para([text('also', [cmsLinkMark('ct-1', 'e-1')])]),
      ])
    );
    expect(refs).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('does NOT dedupe across different entryIds with the same contentTypeId', () => {
    const refs = collectRichtextReferences(
      doc([para([embed('ct-1', 'e-1'), embed('ct-1', 'e-2')])])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-1', entryId: 'e-2' },
    ]);
  });

  it('finds references nested inside blockquote and lists', () => {
    const refs = collectRichtextReferences(
      doc([
        blockquote([para([embed('ct-1', 'e-1')])]),
        bulletList([[para([text('linked', [cmsLinkMark('ct-2', 'e-2')])])]]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-2', entryId: 'e-2' },
    ]);
  });

  it('combines cmsEmbed + cmsLink references in one body', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          embed('ct-1', 'e-1'),
          text('see also', [cmsLinkMark('ct-2', 'e-2')]),
        ]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-2', entryId: 'e-2' },
    ]);
  });

  it('skips cmsEmbed nodes / cmsLink marks with missing or non-string ids', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-1' } }, // no entryId
          { type: 'cmsEmbed', attrs: {} },
          text('x', [{ type: 'cmsLink', attrs: { entryId: 'e-9' } }]),
        ]),
      ])
    );
    expect(refs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter cms vitest run server/utils/collectRichtextReferences.test.ts`
Expected: FAIL with "Cannot find module './collectRichtextReferences'".

- [ ] **Step 3: Implement the walker**

Create `apps/cms/server/utils/collectRichtextReferences.ts`:

```ts
export interface RichtextReference {
  contentTypeId: string;
  entryId: string;
}

/**
 * Walk a ProseMirror JSON document and return the deduplicated set of
 * (contentTypeId, entryId) pairs referenced by:
 *   - `cmsEmbed` atom nodes (attrs.contentTypeId / attrs.entryId)
 *   - `cmsLink` marks attached to text nodes (attrs.contentTypeId / attrs.entryId)
 *
 * Order is document-traversal order. The pair `(ct, e)` appears at most once
 * even if it occurs multiple times across embeds and links. Pairs with
 * missing or non-string ids are silently skipped.
 */
export function collectRichtextReferences(body: unknown): RichtextReference[] {
  const out: RichtextReference[] = [];
  const seen = new Set<string>();

  function pushIfValid(attrs: unknown): void {
    if (!attrs || typeof attrs !== 'object') return;
    const a = attrs as Record<string, unknown>;
    if (typeof a.contentTypeId !== 'string') return;
    if (typeof a.entryId !== 'string') return;
    const key = `${a.contentTypeId}:${a.entryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ contentTypeId: a.contentTypeId, entryId: a.entryId });
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: unknown;
      attrs?: unknown;
      marks?: unknown;
      content?: unknown;
    };

    if (n.type === 'cmsEmbed') {
      pushIfValid(n.attrs);
    }

    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        if (!mark || typeof mark !== 'object') continue;
        const m = mark as { type?: unknown; attrs?: unknown };
        if (m.type === 'cmsLink') {
          pushIfValid(m.attrs);
        }
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(body);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter cms vitest run server/utils/collectRichtextReferences.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/collectRichtextReferences.ts apps/cms/server/utils/collectRichtextReferences.test.ts
git commit -m "feat(richtext): add collectRichtextReferences walker

Pure-function walker that returns deduplicated { contentTypeId, entryId }
pairs from a ProseMirror doc, sourcing both cmsEmbed atom nodes and
cmsLink marks. Used by the upcoming GraphQL references resolver."
```

---

## Task 2: Extend `enrichRichtextEmbeds` to cmsLink marks

**Files:**

- Modify: `apps/cms/server/utils/enrichRichtextEmbeds.ts`
- Modify: `apps/cms/server/utils/enrichRichtextEmbeds.test.ts`

**Why:** On entry save, `enrichEntryDataWithEmbedIdentifiers` walks each RICHTEXT body and stamps `attrs.contentTypeIdentifier` onto every `cmsEmbed` node. With `cmsLink` marks now also referencing entries, identifier stamping must extend to marks for the same reasons (clients dispatch by identifier without a side lookup).

- [ ] **Step 1: Add failing tests for `cmsLink` mark coverage**

Append to `apps/cms/server/utils/enrichRichtextEmbeds.test.ts` (just before the closing of the file, after the last `describe` block):

```ts
// ---------------------------------------------------------------------------
// cmsLink mark coverage
// ---------------------------------------------------------------------------

const cmsLink = (
  contentTypeId: string,
  entryId: string,
  extra?: Record<string, unknown>
) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId, ...extra },
});
const externalLink = (href: string) => ({ type: 'link', attrs: { href } });

describe('collectEmbedContentTypeIds — cmsLink marks', () => {
  it('collects contentTypeId from a cmsLink mark on a text node', () => {
    const result = collectEmbedContentTypeIds(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'visit', marks: [cmsLink('ct-1', 'e-1')] },
          ],
        },
      ])
    );
    expect(result).toEqual(new Set(['ct-1']));
  });

  it('ignores external link marks (type === "link")', () => {
    const result = collectEmbedContentTypeIds(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'visit', marks: [externalLink('https://x')] },
          ],
        },
      ])
    );
    expect(result.size).toBe(0);
  });

  it('combines contentTypeIds from embeds and link marks', () => {
    const result = collectEmbedContentTypeIds(
      doc([
        para([
          embed('ct-1', 'e-1'),
          { type: 'text', text: 'and', marks: [cmsLink('ct-2', 'e-2')] },
        ]),
      ])
    );
    expect(result).toEqual(new Set(['ct-1', 'ct-2']));
  });
});

describe('enrichBodyWithContentTypeIdentifiers — cmsLink marks', () => {
  const map = new Map([
    ['ct-1', 'Author'],
    ['ct-2', 'Page'],
  ]);

  it('stamps identifier on a cmsLink mark', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'visit', marks: [cmsLink('ct-2', 'e-1')] },
        ],
      },
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { marks: { attrs: Record<string, unknown> }[] }[];
      }[];
    };
    expect(result.content[0]!.content[0]!.marks[0]!.attrs).toEqual({
      contentTypeId: 'ct-2',
      entryId: 'e-1',
      contentTypeIdentifier: 'Page',
    });
  });

  it('leaves external link marks untouched', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'visit', marks: [externalLink('https://x')] },
        ],
      },
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: {
          marks: { type: string; attrs: Record<string, unknown> }[];
        }[];
      }[];
    };
    expect(result.content[0]!.content[0]!.marks[0]).toEqual({
      type: 'link',
      attrs: { href: 'https://x' },
    });
  });

  it('does not mutate the input when stamping a cmsLink', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'visit', marks: [cmsLink('ct-1', 'e-1')] },
        ],
      },
    ]);
    const snapshot = JSON.parse(JSON.stringify(input));
    enrichBodyWithContentTypeIdentifiers(input, map);
    expect(input).toEqual(snapshot);
  });

  it('overwrites stale contentTypeIdentifier on a cmsLink mark', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'visit',
            marks: [cmsLink('ct-1', 'e-1', { contentTypeIdentifier: 'Old' })],
          },
        ],
      },
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { marks: { attrs: Record<string, unknown> }[] }[];
      }[];
    };
    expect(
      result.content[0]!.content[0]!.marks[0]!.attrs.contentTypeIdentifier
    ).toBe('Author');
  });

  it('leaves cmsLink mark attrs alone if contentTypeId is not in the map', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'visit',
            marks: [cmsLink('ct-unknown', 'e-1')],
          },
        ],
      },
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { marks: { attrs: Record<string, unknown> }[] }[];
      }[];
    };
    expect(
      'contentTypeIdentifier' in result.content[0]!.content[0]!.marks[0]!.attrs
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail, existing tests still pass**

Run: `pnpm --filter cms vitest run server/utils/enrichRichtextEmbeds.test.ts`
Expected: previous tests PASS, the 8 newly-added tests FAIL (the existing implementation only walks embeds and `content`, not `marks`).

- [ ] **Step 3: Extend `collectEmbedContentTypeIds` in `apps/cms/server/utils/enrichRichtextEmbeds.ts`**

Replace the body of `collectEmbedContentTypeIds` (lines 11-29) with:

```ts
export function collectEmbedContentTypeIds(
  body: unknown,
  out: Set<string> = new Set()
): Set<string> {
  if (!body || typeof body !== 'object') return out;
  const n = body as {
    type?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
  };
  if (n.type === 'cmsEmbed') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (typeof attrs.contentTypeId === 'string') {
      out.add(attrs.contentTypeId);
    }
  }
  if (Array.isArray(n.marks)) {
    for (const mark of n.marks) {
      if (!mark || typeof mark !== 'object') continue;
      const m = mark as { type?: unknown; attrs?: unknown };
      if (m.type === 'cmsLink') {
        const a = (m.attrs ?? {}) as Record<string, unknown>;
        if (typeof a.contentTypeId === 'string') out.add(a.contentTypeId);
      }
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

- [ ] **Step 4: Extend `enrichBodyWithContentTypeIdentifiers` to stamp cmsLink marks**

Replace the body of `enrichBodyWithContentTypeIdentifiers` (lines 41-87) with:

```ts
export function enrichBodyWithContentTypeIdentifiers(
  body: unknown,
  identifierMap: Map<string, string>
): unknown {
  if (!body || typeof body !== 'object') return body;

  const n = body as {
    type?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
    [key: string]: unknown;
  };

  let result: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;

  if (n.type === 'cmsEmbed') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    const identifier =
      typeof attrs.contentTypeId === 'string'
        ? identifierMap.get(attrs.contentTypeId)
        : undefined;
    if (identifier !== undefined) {
      result = {
        ...result,
        attrs: { ...attrs, contentTypeIdentifier: identifier },
      };
    }
    return result;
  }

  if (Array.isArray(n.marks)) {
    const newMarks = n.marks.map((mark) => {
      if (!mark || typeof mark !== 'object') return mark;
      const m = mark as { type?: unknown; attrs?: unknown };
      if (m.type !== 'cmsLink') return mark;
      const attrs = (m.attrs ?? {}) as Record<string, unknown>;
      const identifier =
        typeof attrs.contentTypeId === 'string'
          ? identifierMap.get(attrs.contentTypeId)
          : undefined;
      if (identifier === undefined) return mark;
      return { ...m, attrs: { ...attrs, contentTypeIdentifier: identifier } };
    });
    result = { ...result, marks: newMarks };
  }

  if (Array.isArray(n.content)) {
    const newContent = n.content.map((child) =>
      enrichBodyWithContentTypeIdentifiers(child, identifierMap)
    );
    result = { ...result, content: newContent };
  }

  return result;
}
```

- [ ] **Step 5: Run tests — all green**

Run: `pnpm --filter cms vitest run server/utils/enrichRichtextEmbeds.test.ts`
Expected: PASS, all tests green (existing + 8 new).

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/enrichRichtextEmbeds.ts apps/cms/server/utils/enrichRichtextEmbeds.test.ts
git commit -m "feat(richtext): stamp contentTypeIdentifier on cmsLink marks

Extends enrichRichtextEmbeds to also collect contentTypeIds from cmsLink
marks attached to text nodes and stamp the canonical
contentTypeIdentifier into each link mark on save. External link marks
(type === 'link') are left untouched."
```

---

## Task 3: Validator — cmsLink mark validation + `linkTargetContentTypeIds`

**Files:**

- Modify: `apps/cms/server/utils/validateEntryData.ts`
- Modify: `apps/cms/server/utils/validateEntryData.test.ts`

**Why:** The RICHTEXT validator currently only inspects `cmsEmbed` nodes against `targetContentTypeIds`. We need it to also inspect `cmsLink` marks against the new `linkTargetContentTypeIds` allow-list.

- [ ] **Step 1: Add failing tests for cmsLink validation**

Locate the RICHTEXT-related describe block in `apps/cms/server/utils/validateEntryData.test.ts` (search for `'RICHTEXT'`). Append the following tests inside whichever describe block contains the existing `cmsEmbed` tests (or create a new `describe('RICHTEXT — cmsLink marks')` block at the end of the RICHTEXT section):

```ts
describe('RICHTEXT — cmsLink marks', () => {
  const fields = (
    allowedLinks: string[]
  ): Parameters<typeof validateEntryData>[1] => [
    {
      identifier: 'body',
      name: 'Body',
      type: 'RICHTEXT',
      required: false,
      options: { linkTargetContentTypeIds: allowedLinks },
    },
  ];

  const docWithLink = (contentTypeId: string, entryId: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'click',
            marks: [{ type: 'cmsLink', attrs: { contentTypeId, entryId } }],
          },
        ],
      },
    ],
  });

  it('accepts a cmsLink mark whose contentTypeId is in linkTargetContentTypeIds', async () => {
    const data = { body: docWithLink('ct-page', 'e-1') };
    const result = await validateEntryData(data, fields(['ct-page']));
    expect(result.body).toEqual(data.body);
  });

  it('rejects a cmsLink mark whose contentTypeId is NOT in linkTargetContentTypeIds', async () => {
    const data = { body: docWithLink('ct-other', 'e-1') };
    await expect(validateEntryData(data, fields(['ct-page']))).rejects.toThrow(
      /Body: Entry link references a content type that is not allowed/
    );
  });

  it('rejects any cmsLink mark when linkTargetContentTypeIds is empty', async () => {
    const data = { body: docWithLink('ct-page', 'e-1') };
    await expect(validateEntryData(data, fields([]))).rejects.toThrow(
      /Body: Entry links are not allowed in this field/
    );
  });

  it('rejects a cmsLink mark missing required ids', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  { type: 'cmsLink', attrs: { contentTypeId: 'ct-page' } },
                ],
              },
            ],
          },
        ],
      },
    };
    await expect(validateEntryData(data, fields(['ct-page']))).rejects.toThrow(
      /Body: Invalid entry link \(missing contentTypeId or entryId\)/
    );
  });

  it('does not reject external link marks when no link allow-list is set', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'https://x.test' } }],
              },
            ],
          },
        ],
      },
    };
    const result = await validateEntryData(data, fields([]));
    expect(result.body).toEqual(data.body);
  });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

Run: `pnpm --filter cms vitest run server/utils/validateEntryData.test.ts`
Expected: existing tests PASS, the 5 new ones FAIL (validator does not yet inspect marks).

- [ ] **Step 3: Update RICHTEXT case to read both allow-lists**

In `apps/cms/server/utils/validateEntryData.ts`, replace the entire `case 'RICHTEXT': { … }` block (currently lines 103-121) with:

```ts
case 'RICHTEXT': {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must be a JSON object`,
    });
  }
  const rtOpts = field.options as {
    targetContentTypeIds?: string[];
    linkTargetContentTypeIds?: string[];
  } | null;
  const allowedEmbedTypes = rtOpts?.targetContentTypeIds ?? [];
  const allowedLinkTypes = rtOpts?.linkTargetContentTypeIds ?? [];
  validateRichtextReferences(
    value,
    allowedEmbedTypes,
    allowedLinkTypes,
    field.name
  );
  validated[field.identifier] = value;
  break;
}
```

- [ ] **Step 4: Replace `validateRichtextEmbeds` helper with combined `validateRichtextReferences`**

In `apps/cms/server/utils/validateEntryData.ts`, replace the entire `validateRichtextEmbeds` function (currently lines 336-374) with:

```ts
/**
 * Walk a ProseMirror JSON document, asserting:
 *   - every `cmsEmbed` node's `contentTypeId` is in `allowedEmbedTypes`
 *   - every `cmsLink` mark's `contentTypeId` is in `allowedLinkTypes`
 * Empty allow-lists mean the corresponding feature is not allowed at all.
 * External link marks (type === 'link') are unaffected.
 */
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
      marks?: unknown;
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

    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        if (!mark || typeof mark !== 'object') continue;
        const m = mark as { type?: unknown; attrs?: unknown };
        if (m.type !== 'cmsLink') continue;
        const a = (m.attrs ?? {}) as Record<string, unknown>;
        if (
          typeof a.contentTypeId !== 'string' ||
          typeof a.entryId !== 'string'
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
        if (!allowedLinkTypes.includes(a.contentTypeId)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${fieldName}: Entry link references a content type that is not allowed for this field.`,
          });
        }
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
}
```

- [ ] **Step 5: Run tests — all green**

Run: `pnpm --filter cms vitest run server/utils/validateEntryData.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/validateEntryData.ts apps/cms/server/utils/validateEntryData.test.ts
git commit -m "feat(richtext): validate cmsLink marks against linkTargetContentTypeIds

Renames the per-field validator to validateRichtextReferences and walks
text-node marks in addition to nodes. cmsLink marks are gated by a new
linkTargetContentTypeIds option, independent of the existing embed
allow-list. External link marks remain unaffected."
```

---

## Task 4: GraphQL — `RichText` object type with `json` + `references`

**Files:**

- Modify: `apps/cms/server/graphql/dynamicTypes.ts`
- Modify: `apps/cms/server/api/graphql/graphql.test.ts`

**Why:** The user-visible win — exposing one batched query for body + referenced entries. We add the integration test covering cmsEmbed-only first; cmsLink coverage lands in Task 8 once we have an editor that produces the marks (and we can keep the test simpler by hand-crafting a doc with both via the REST API, which we can do here too — but we keep the slice small and revisit in Task 8).

- [ ] **Step 1: Write failing integration test for `body { json references }`**

In `apps/cms/server/api/graphql/graphql.test.ts`, locate the existing `describe('GraphQL API', async () => { … })` block. Add a new top-level `describe` block at the end of the file (after the closing of the existing `describe`):

```ts
describe('GraphQL API — RICHTEXT references', async () => {
  await setup({ dev: true });

  let articleTypeId: string;
  let tagTypeId: string;
  let tag1Id: string;
  let tag2Id: string;
  let articleEntryId: string;

  beforeAll(async () => {
    const cookie = await getSessionCookie();

    // Cleanup any prior run
    const existing = await $fetch<{
      items: Array<{ id: string; identifier: string }>;
    }>('/api/content-types?perPage=200', { headers: { cookie } }).catch(() => ({
      items: [],
    }));
    for (const id of ['RtArticle', 'RtTag']) {
      const ct = existing.items?.find?.((c) => c.identifier === id);
      if (!ct) continue;
      const entries = await $fetch<{ items: Array<{ id: string }> }>(
        `/api/content-entries?contentTypeId=${ct.id}&perPage=200`,
        { headers: { cookie } }
      ).catch(() => ({ items: [] }));
      for (const e of entries.items ?? []) {
        await $fetch<unknown>(`/api/content-entries/${e.id}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
      await $fetch<unknown>(`/api/content-types/${ct.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    }

    // Create RtTag content type
    const tagType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: 'Rt Tag',
        identifier: 'RtTag',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: 'SLUG' },
        ],
      },
    });
    tagTypeId = tagType.id;

    const tag1 = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: tagTypeId,
        data: { title: 'News', slug: 'news' },
        status: 'PUBLISHED',
      },
    });
    tag1Id = tag1.id;
    const tag2 = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: tagTypeId,
        data: { title: 'Sport', slug: 'sport' },
        status: 'PUBLISHED',
      },
    });
    tag2Id = tag2.id;

    // Create RtArticle with a RICHTEXT body that allows RtTag embeds
    const articleType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: 'Rt Article',
        identifier: 'RtArticle',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          {
            identifier: 'body',
            name: 'Body',
            type: 'RICHTEXT',
            options: { targetContentTypeIds: [tagTypeId] },
          },
        ],
      },
    });
    articleTypeId = articleType.id;

    const article = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: articleTypeId,
        data: {
          title: 'Hello World',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'See ' },
                  {
                    type: 'cmsEmbed',
                    attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                  },
                  { type: 'text', text: ' and ' },
                  {
                    type: 'cmsEmbed',
                    attrs: { contentTypeId: tagTypeId, entryId: tag2Id },
                  },
                  { type: 'text', text: '.' },
                ],
              },
              {
                // Same tag1 referenced again — must be deduplicated
                type: 'paragraph',
                content: [
                  {
                    type: 'cmsEmbed',
                    attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                  },
                ],
              },
            ],
          },
        },
        status: 'PUBLISHED',
      },
    });
    articleEntryId = article.id;
  });

  afterAll(async () => {
    const cookie = await getSessionCookie();
    for (const ctId of [articleTypeId, tagTypeId]) {
      const entries = await $fetch<{ items: Array<{ id: string }> }>(
        `/api/content-entries?contentTypeId=${ctId}&perPage=200`,
        { headers: { cookie } }
      ).catch(() => ({ items: [] }));
      for (const e of entries.items ?? []) {
        await $fetch<unknown>(`/api/content-entries/${e.id}`, {
          method: 'DELETE',
          headers: { cookie },
        }).catch(() => {});
      }
      await $fetch<unknown>(`/api/content-types/${ctId}`, {
        method: 'DELETE',
        headers: { cookie },
      }).catch(() => {});
    }
  });

  it('returns json + deduplicated references with fragment-narrowed types', async () => {
    const res = await gql<{
      rtArticle: {
        id: string;
        body: {
          json: { type: string };
          references: Array<{ __typename: string; id: string; slug?: string }>;
        };
      };
    }>(`
      query {
        rtArticle(id: "${articleEntryId}") {
          id
          body {
            json
            references {
              __typename
              id
              ... on RtTag { slug }
            }
          }
        }
      }
    `);

    expect(res.errors).toBeUndefined();
    expect(res.data.rtArticle.body.json.type).toBe('doc');

    const refs = res.data.rtArticle.body.references;
    expect(refs).toHaveLength(2);
    const sortedSlugs = refs.map((r) => r.slug).sort();
    expect(sortedSlugs).toEqual(['news', 'sport']);
    for (const r of refs) {
      expect(r.__typename).toBe('RtTag');
    }
  });

  it('returns an empty references array for a body with no references', async () => {
    const cookie = await getSessionCookie();
    const created = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: articleTypeId,
        data: {
          title: 'Plain',
          body: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
            ],
          },
        },
        status: 'PUBLISHED',
      },
    });

    const res = await gql<{
      rtArticle: { body: { references: unknown[] } };
    }>(`
      query {
        rtArticle(id: "${created.id}") {
          body { references { __typename id } }
        }
      }
    `);
    expect(res.errors).toBeUndefined();
    expect(res.data.rtArticle.body.references).toEqual([]);
  });

  it('drops references whose target has no PUBLISHED version', async () => {
    const cookie = await getSessionCookie();
    // Create a draft-only tag
    const draftTag = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: tagTypeId,
        data: { title: 'Draft', slug: 'draft' },
        // status defaults to DRAFT
      },
    });

    const article = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: {
        contentTypeId: articleTypeId,
        data: {
          title: 'WithDraftRef',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'cmsEmbed',
                    attrs: { contentTypeId: tagTypeId, entryId: draftTag.id },
                  },
                ],
              },
            ],
          },
        },
        status: 'PUBLISHED',
      },
    });

    const res = await gql<{
      rtArticle: { body: { references: unknown[] } };
    }>(`
      query {
        rtArticle(id: "${article.id}") {
          body { references { __typename id } }
        }
      }
    `);
    expect(res.errors).toBeUndefined();
    expect(res.data.rtArticle.body.references).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails (RICHTEXT is still scalar JSON, no `body { json references }` shape)**

Run: `pnpm --filter cms vitest run server/api/graphql/graphql.test.ts`
Expected: existing tests PASS; new RICHTEXT-references tests FAIL (GraphQL error like "Field \"json\" must not have a selection since type \"JSON\" has no subfields", or similar).

- [ ] **Step 3: Register the shared `RichText` object type and per-field resolver in `dynamicTypes.ts`**

Open `apps/cms/server/graphql/dynamicTypes.ts`.

3a. **Remove `RICHTEXT` from `FIELD_TYPE_TO_SCALAR`** — at line 86, delete the line `RICHTEXT: 'JSON',`. The map should now end at `SELECT: 'String',` followed by the closing `}`.

3b. **Add the import for the walker** at the top of the file, alongside the existing `prisma` import:

```ts
import { collectRichtextReferences } from '../utils/collectRichtextReferences';
```

3c. **Register the shared `RichText` objectRef inside `registerDynamicTypes`** — directly after the `ContentEntryInterface` block (after the closing of `.implement({ ... })` for the interface, before `const dynFilters = ...`), insert:

```ts
interface RichTextShape {
  json: unknown;
}

const RichTextRef = builder.objectRef<RichTextShape>('RichText').implement({
  fields: (t) => ({
    json: t.field({
      type: 'JSON',
      resolve: (rt) => rt.json as never,
    }),
    references: t.field({
      type: [ContentEntryInterface],
      resolve: async (rt) => {
        const refs = collectRichtextReferences(rt.json);
        if (refs.length === 0) return [];
        const entryIds = refs.map((r) => r.entryId);
        const entries = await prisma.contentEntry.findMany({
          where: { id: { in: entryIds } },
          include: { versions: { where: { status: 'PUBLISHED' } } },
        });
        const byId = new Map<string, ContentEntryShape>();
        for (const e of entries) {
          if (e.versions.length === 0) continue;
          if (!typeIdToIdentifier.has(e.contentTypeId)) continue;
          byId.set(e.id, flattenToShape(e, e.versions[0]!));
        }
        return refs
          .map((r) => byId.get(r.entryId))
          .filter((e): e is ContentEntryShape => Boolean(e));
      },
    }),
  }),
});
```

3d. **Register RICHTEXT fields with the new ref** — inside the per-content-type loop (`for (const ct of contentTypes)`), after the existing `for (const field of scalarFields)` loop and before the `// RELATION fields ...` block, insert:

```ts
const richtextFields = ct.fields.filter((f) => f.type === 'RICHTEXT');
for (const field of richtextFields) {
  fields[field.identifier] = t.field({
    type: RichTextRef,
    nullable: !field.required,
    resolve: (entry: ContentEntryShape) => {
      const data =
        typeof entry.data === 'string'
          ? (JSON.parse(entry.data) as Record<string, unknown>)
          : (entry.data as Record<string, unknown> | null);
      const json = data?.[field.identifier];
      if (json == null) return null;
      return { json };
    },
  }) as never;
}
```

- [ ] **Step 4: Run integration tests — all green**

Run: `pnpm --filter cms vitest run server/api/graphql/graphql.test.ts`
Expected: PASS, all tests green (existing + 3 new RICHTEXT references tests).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter cms typecheck`
Expected: no errors. (If any cast complaints arise from `t.field({ type: [ContentEntryInterface] })`, narrow with `as never` mirroring the existing patterns in this file.)

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/graphql/dynamicTypes.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): expose RICHTEXT as RichText { json, references }

RICHTEXT fields are now an object type instead of a JSON scalar. The
references field returns deduplicated PUBLISHED ContentEntry instances
referenced by cmsEmbed nodes (and, after Task 5, cmsLink marks) in the
body, in one batched findMany. Consumers spread per-type fragments
against the shared ContentEntry interface.

BREAKING: existing clients reading 'body' as raw JSON must migrate to
'body { json }'."
```

---

## Task 5: Editor — `CmsLink` Tiptap mark + RichTextEditor wiring

**Files:**

- Create: `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`
- Modify: `apps/cms/components/rich-text-editor/RichTextEditor.vue`
- Modify: `apps/cms/components/rich-text-editor/richTextEditor.types.ts`
- Modify: `apps/cms/components/rich-text-editor/richTextEditor.config.ts`

**Why:** The editor produces the JSON that the validator and walker now know how to handle. We add a new mark (separate from Tiptap's external `Link`) and a toolbar button that opens the existing `EntryPickerModal` scoped to the link allow-list.

**Note on UX scope:** Marks in Tiptap don't have node views (those are for nodes). The visible editor surface is the wrapped text styled distinctively via CSS — no per-mark resolved label. This matches `Link`'s editor UX. A richer in-editor preview (tooltip/popover with the entry's title) is out of scope for this plan.

- [ ] **Step 1: Create the `CmsLink` mark file**

Create `apps/cms/components/rich-text-editor/extensions/CmsLink.ts`:

```ts
import { Mark, mergeAttributes } from '@tiptap/core';

export interface CmsLinkAttrs {
  contentTypeId: string | null;
  entryId: string | null;
  contentTypeIdentifier: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cmsLink: {
      setCmsLink: (attrs: {
        contentTypeId: string;
        entryId: string;
      }) => ReturnType;
      unsetCmsLink: () => ReturnType;
    };
  }
}

export const CmsLink = Mark.create({
  name: 'cmsLink',
  inclusive: false,
  exitable: true,
  excludes: '_',

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
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-cms-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-cms-link': '',
        class: 'cms-link',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCmsLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetCmsLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
```

- [ ] **Step 2: Add `LINK_BTN` test id**

In `apps/cms/components/rich-text-editor/richTextEditor.config.ts`, replace the file with:

```ts
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_RICH_TEXT_EDITOR = {
  ...testIds('RICH_TEXT_EDITOR', {
    EMBED_BTN: 'embed-btn',
    CMS_LINK_BTN: 'cms-link-btn',
  }),
};
```

- [ ] **Step 3: Add `linkTargetContentTypeIds` to props type**

In `apps/cms/components/rich-text-editor/richTextEditor.types.ts`, replace the file with:

```ts
import type { BasicComponentProps } from '~/types/basicComponentProps';

export type RichTextEditorProps = BasicComponentProps & {
  modelValue: unknown;
  targetContentTypeIds?: string[];
  linkTargetContentTypeIds?: string[];
};
```

- [ ] **Step 4: Wire the mark + toolbar into `RichTextEditor.vue`**

In `apps/cms/components/rich-text-editor/RichTextEditor.vue`:

4a. Add the import alongside `CmsEmbed` (after the existing `import { CmsEmbed } from './extensions/CmsEmbed';` line):

```ts
import { CmsLink } from './extensions/CmsLink';
```

4b. Add a default for the new prop. Replace the `withDefaults(...)` call with:

```ts
const props = withDefaults(defineProps<RichTextEditorProps>(), {
  testId: QA_RICH_TEXT_EDITOR.COMPONENT,
  targetContentTypeIds: () => [],
  linkTargetContentTypeIds: () => [],
});
```

4c. Below the existing `embedsEnabled` computed, add:

```ts
const cmsLinksEnabled = computed(
  () => (props.linkTargetContentTypeIds?.length ?? 0) > 0
);
```

4d. Update the `extensions` computed to conditionally include `CmsLink`. Replace the existing `extensions` block with:

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

4e. Add a second picker state + handler. After the existing `pickerOpen`/`openEmbedPicker`/`handleEmbedSelect` block, add:

```ts
const linkPickerOpen = ref(false);
function openCmsLinkPicker() {
  if (!editor.value) return;
  // Require a non-empty selection so we have text to wrap
  const { from, to } = editor.value.state.selection;
  if (from === to) {
    window.alert('Select some text to turn into an entry link.');
    return;
  }
  linkPickerOpen.value = true;
}
function handleCmsLinkSelect(data: { contentTypeId: string; entryId: string }) {
  if (!editor.value) return;
  editor.value
    .chain()
    .focus()
    .setMark('cmsLink', {
      contentTypeId: data.contentTypeId,
      entryId: data.entryId,
    })
    .run();
  linkPickerOpen.value = false;
}
```

4f. Add a toolbar button next to the existing embed button. Inside the toolbar `<div>`, immediately after the `v-if="embedsEnabled"` `UButton`, insert:

```vue
<UButton
  v-if="cmsLinksEnabled"
  variant="ghost"
  size="xs"
  icon="i-lucide-link-2"
  :color="editor?.isActive('cmsLink') ? 'primary' : 'neutral'"
  :data-testid="QA_RICH_TEXT_EDITOR.CMS_LINK_BTN"
  aria-label="Link to entry"
  @click="openCmsLinkPicker"
/>
```

4g. Add the second `EntryPickerModal` next to the existing one. Inside the root `<div>` template, after the existing `EntryPickerModal`, add:

```vue
<EntryPickerModal
  v-if="linkPickerOpen"
  :open="linkPickerOpen"
  :target-content-type-ids="linkTargetContentTypeIds"
  @select="handleCmsLinkSelect"
  @close="linkPickerOpen = false"
/>
```

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev` (in another terminal), open the CMS in a browser, and:

1. Edit a content type that has a RICHTEXT field; ensure it has at least one entry in `linkTargetContentTypeIds` (Task 7 will add this UI — for now, you can poke the option directly via Prisma Studio: `pnpx prisma studio` and edit the `ContentTypeField.options` JSON to `{"linkTargetContentTypeIds": ["<some-content-type-id>"]}`).
2. Open an entry of that content type and select some text in the RICHTEXT field.
3. Click the new "Link to entry" button (chain-link icon).
4. Confirm the entry picker opens scoped to the configured allow-list.
5. Pick an entry — confirm the selected text is now wrapped in an `<a class="cms-link" data-…>` element (inspect DOM).
6. Save the entry; reload — the mark should round-trip via `body { json }`.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/components/rich-text-editor/extensions/CmsLink.ts \
        apps/cms/components/rich-text-editor/RichTextEditor.vue \
        apps/cms/components/rich-text-editor/richTextEditor.types.ts \
        apps/cms/components/rich-text-editor/richTextEditor.config.ts
git commit -m "feat(richtext): add cmsLink Tiptap mark + toolbar button

Introduces a new mark distinct from Tiptap's external-URL Link mark,
storing { contentTypeId, entryId, contentTypeIdentifier }. The editor
conditionally registers it when linkTargetContentTypeIds is non-empty
and surfaces a toolbar button that opens the EntryPickerModal scoped
to the field's allow-list."
```

---

## Task 6: Field config plumbing — `RichtextFieldConfig` & `mapFieldToConfig`

**Files:**

- Modify: `apps/cms/types/contentEditor.ts`
- Modify: `apps/cms/utils/mapFieldToConfig.ts`
- Modify: `apps/cms/components/content-editor/ContentEditor.vue`

**Why:** The new prop on `RichTextEditor` needs to flow from `ContentTypeField.options.linkTargetContentTypeIds` through the field config to the rendered editor.

- [ ] **Step 1: Add `linkTargetContentTypeIds` to `RichtextFieldConfig`**

In `apps/cms/types/contentEditor.ts`, locate `RichtextFieldConfig` (around line 56) and replace it with:

```ts
export interface RichtextFieldConfig {
  type: 'richtext';
  key: string;
  label: string;
  targetContentTypeIds?: string[];
  linkTargetContentTypeIds?: string[];
}
```

- [ ] **Step 2: Read the new option in `mapFieldToConfig`**

In `apps/cms/utils/mapFieldToConfig.ts`, locate the `case 'RICHTEXT':` block (around line 58-68) and replace it with:

```ts
case 'RICHTEXT': {
  const opts = field.options as {
    targetContentTypeIds?: string[];
    linkTargetContentTypeIds?: string[];
  } | null;
  return {
    type: 'richtext',
    key: field.identifier,
    label: field.name,
    targetContentTypeIds: opts?.targetContentTypeIds ?? [],
    linkTargetContentTypeIds: opts?.linkTargetContentTypeIds ?? [],
  };
}
```

- [ ] **Step 3: Pass the new prop through `ContentEditor.vue`**

In `apps/cms/components/content-editor/ContentEditor.vue`, locate the `RichTextEditor` rendering (search for `:target-content-type-ids="field.targetContentTypeIds`). Replace the `<RichTextEditor>` usage with:

```vue
<RichTextEditor
  :model-value="state[field.key]"
  :target-content-type-ids="field.targetContentTypeIds ?? []"
  :link-target-content-type-ids="field.linkTargetContentTypeIds ?? []"
  @update:model-value="(val) => (state[field.key] = val)"
/>
```

(Keep any existing event/slot bindings intact — only add the `:link-target-content-type-ids` line. The exact line range to edit is around `apps/cms/components/content-editor/ContentEditor.vue:265`. Verify by reading that block first.)

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter cms typecheck`
Expected: no errors.

- [ ] **Step 5: Run unit tests**

Run: `pnpm --filter cms test:unit`
Expected: all green (no behavioural changes; this task is plumbing).

- [ ] **Step 6: Commit**

```bash
git add apps/cms/types/contentEditor.ts apps/cms/utils/mapFieldToConfig.ts apps/cms/components/content-editor/ContentEditor.vue
git commit -m "feat(richtext): plumb linkTargetContentTypeIds through field config

Reads the new option off ContentTypeField.options, exposes it on
RichtextFieldConfig, and forwards it from ContentEditor to
RichTextEditor."
```

---

## Task 7: Content-type config UI — second chip picker

**Files:**

- Modify: `apps/cms/pages/content-types/new.vue`
- Modify: `apps/cms/pages/content-types/[id]/index.vue`

**Why:** Editors need a UI to set `linkTargetContentTypeIds`. The existing RICHTEXT options already render one `ContentTypeChipPicker` for embeds; we add a second one for links.

- [ ] **Step 1: Replace the RICHTEXT branch in `pages/content-types/new.vue` with a two-picker template**

Open `apps/cms/pages/content-types/new.vue`. Locate the existing `<UFormField v-else-if="type === 'RICHTEXT'" label="Allowed inline embed types">…</UFormField>` block (around lines 379-398). Replace it (the entire `<UFormField>` element) with the following `<template v-else-if>` wrapping BOTH pickers:

```vue
<template v-else-if="type === 'RICHTEXT'">
  <UFormField label="Allowed inline embed types">
    <ContentTypeChipPicker
      :model-value="
        options &&
        typeof options === 'object' &&
        'targetContentTypeIds' in options
          ? (options as { targetContentTypeIds: string[] })
              .targetContentTypeIds
          : []
      "
      :options="contentTypeOptions ?? []"
      empty-hint="No inline embeds will be allowed in this field. Add a content type to enable inline embeds."
      @update:model-value="
        (val: string[]) => updateOptions({ targetContentTypeIds: val })
      "
    />
  </UFormField>
  <UFormField label="Allowed entry-link target types">
    <ContentTypeChipPicker
      :model-value="
        options &&
        typeof options === 'object' &&
        'linkTargetContentTypeIds' in options
          ? (options as { linkTargetContentTypeIds: string[] })
              .linkTargetContentTypeIds
          : []
      "
      :options="contentTypeOptions ?? []"
      empty-hint="No entry links will be allowed in this field. Add a content type to enable entry links."
      @update:model-value="
        (val: string[]) => updateOptions({ linkTargetContentTypeIds: val })
      "
    />
  </UFormField>
</template>
```

(Why the `<template v-else-if>` wrapper: Vue's `v-else-if` chain matches only the first truthy branch, so to render both pickers under the same `RICHTEXT` condition they must share one branch.)

- [ ] **Step 2: Apply the equivalent change to `pages/content-types/[id]/index.vue`**

Open `apps/cms/pages/content-types/[id]/index.vue`. Locate the equivalent RICHTEXT block (around lines 530-545; search for `'targetContentTypeIds' in options` and find the occurrence inside `v-else-if="type === 'RICHTEXT'"`). Replace that single `<UFormField>` element with the same `<template v-else-if="type === 'RICHTEXT'">…</template>` block as Step 1:

```vue
<template v-else-if="type === 'RICHTEXT'">
  <UFormField label="Allowed inline embed types">
    <ContentTypeChipPicker
      :model-value="
        options &&
        typeof options === 'object' &&
        'targetContentTypeIds' in options
          ? (options as { targetContentTypeIds: string[] })
              .targetContentTypeIds
          : []
      "
      :options="contentTypeOptions ?? []"
      empty-hint="No inline embeds will be allowed in this field. Add a content type to enable inline embeds."
      @update:model-value="
        (val: string[]) => updateOptions({ targetContentTypeIds: val })
      "
    />
  </UFormField>
  <UFormField label="Allowed entry-link target types">
    <ContentTypeChipPicker
      :model-value="
        options &&
        typeof options === 'object' &&
        'linkTargetContentTypeIds' in options
          ? (options as { linkTargetContentTypeIds: string[] })
              .linkTargetContentTypeIds
          : []
      "
      :options="contentTypeOptions ?? []"
      empty-hint="No entry links will be allowed in this field. Add a content type to enable entry links."
      @update:model-value="
        (val: string[]) => updateOptions({ linkTargetContentTypeIds: val })
      "
    />
  </UFormField>
</template>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter cms typecheck`
Expected: no errors.

- [ ] **Step 4: Manual UI smoke test**

Start the dev server (`pnpm dev`), navigate to:

1. `/content-types/new` — choose RICHTEXT for a field. Confirm both pickers render: "Allowed inline embed types" and "Allowed entry-link target types".
2. Create a content type that has a RICHTEXT field with both options populated. Save.
3. Open `/content-types/<id>` for the new type, edit the RICHTEXT field — confirm both pickers preload from the saved options and changes persist on save.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/pages/content-types/new.vue apps/cms/pages/content-types/\[id\]/index.vue
git commit -m "feat(richtext): add link-target chip picker to content-type config

The RICHTEXT field options now expose two independent allow-lists:
'Allowed inline embed types' (existing) and 'Allowed entry-link target
types' (new). Both are configured via ContentTypeChipPicker on the
content-type new and edit pages."
```

---

## Task 8: GraphQL integration test — cmsLink references end-to-end

**Files:**

- Modify: `apps/cms/server/api/graphql/graphql.test.ts`

**Why:** Closes the loop. Confirms `cmsLink` marks created via the REST API surface in `references` and that dedup works when the same entry is both embedded and linked.

- [ ] **Step 1: Add a new test case inside the `describe('GraphQL API — RICHTEXT references', …)` block from Task 4**

Inside that describe block, add the following setup at the top of the existing `beforeAll` — extend the article content type to also allow links to RtTag, and create a second article that mixes embeds + links. To minimise churn: add a fresh `it` block at the end of the describe that creates its own article on the fly:

```ts
it('combines cmsEmbed nodes and cmsLink marks in references with cross-source dedup', async () => {
  const cookie = await getSessionCookie();

  // Re-create the article type with both allow-lists, since the original
  // setup only enabled embeds.
  await $fetch<unknown>(`/api/content-types/${articleTypeId}`, {
    method: 'PUT',
    headers: { cookie },
    body: {
      // identifier is immutable — only update modifiable fields
      name: 'Rt Article',
      description: null,
    },
  }).catch(() => {});

  // Locate the body field id and patch its options
  const ct = await $fetch<{
    fields: Array<{ id: string; identifier: string }>;
  }>(`/api/content-types/${articleTypeId}`, { headers: { cookie } });
  const bodyField = ct.fields.find((f) => f.identifier === 'body');
  expect(bodyField).toBeTruthy();
  await $fetch<unknown>(
    `/api/content-types/${articleTypeId}/fields/${bodyField!.id}`,
    {
      method: 'PUT',
      headers: { cookie },
      body: {
        name: 'Body',
        required: false,
        options: {
          targetContentTypeIds: [tagTypeId],
          linkTargetContentTypeIds: [tagTypeId],
        },
      },
    }
  );

  const article = await $fetch<{ id: string }>('/api/content-entries', {
    method: 'POST',
    headers: { cookie },
    body: {
      contentTypeId: articleTypeId,
      data: {
        title: 'Mixed',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                // Embed of tag1
                {
                  type: 'cmsEmbed',
                  attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                },
                { type: 'text', text: ' and ' },
                // Link wrapping text, also targeting tag1 — must dedup
                {
                  type: 'text',
                  text: 'see news',
                  marks: [
                    {
                      type: 'cmsLink',
                      attrs: { contentTypeId: tagTypeId, entryId: tag1Id },
                    },
                  ],
                },
                { type: 'text', text: ' or ' },
                // Link to tag2
                {
                  type: 'text',
                  text: 'sport',
                  marks: [
                    {
                      type: 'cmsLink',
                      attrs: { contentTypeId: tagTypeId, entryId: tag2Id },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      status: 'PUBLISHED',
    },
  });

  const res = await gql<{
    rtArticle: {
      body: {
        references: Array<{ __typename: string; id: string; slug?: string }>;
      };
    };
  }>(`
    query {
      rtArticle(id: "${article.id}") {
        body {
          references {
            __typename
            id
            ... on RtTag { slug }
          }
        }
      }
    }
  `);
  expect(res.errors).toBeUndefined();

  const refs = res.data.rtArticle.body.references;
  expect(refs).toHaveLength(2);
  const slugs = refs.map((r) => r.slug).sort();
  expect(slugs).toEqual(['news', 'sport']);
});

it('rejects entry creation with a cmsLink mark targeting a disallowed type', async () => {
  const cookie = await getSessionCookie();

  // Create a sibling content type that the body field does NOT allow as a link target
  const other = await $fetch<{ id: string }>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: 'Rt Other',
      identifier: 'RtOther',
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    },
  });

  const otherEntry = await $fetch<{ id: string }>('/api/content-entries', {
    method: 'POST',
    headers: { cookie },
    body: {
      contentTypeId: other.id,
      data: { title: 'Other' },
      status: 'PUBLISHED',
    },
  });

  const create = $fetch<unknown>('/api/content-entries', {
    method: 'POST',
    headers: { cookie },
    body: {
      contentTypeId: articleTypeId,
      data: {
        title: 'Disallowed',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'click',
                  marks: [
                    {
                      type: 'cmsLink',
                      attrs: {
                        contentTypeId: other.id,
                        entryId: otherEntry.id,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  });

  await expect(create).rejects.toMatchObject({
    statusCode: 400,
  });

  // Cleanup
  await $fetch<unknown>(`/api/content-entries/${otherEntry.id}`, {
    method: 'DELETE',
    headers: { cookie },
  }).catch(() => {});
  await $fetch<unknown>(`/api/content-types/${other.id}`, {
    method: 'DELETE',
    headers: { cookie },
  }).catch(() => {});
});
```

- [ ] **Step 2: Run the integration test file**

Run: `pnpm --filter cms vitest run server/api/graphql/graphql.test.ts`
Expected: PASS, all tests green (existing + 2 new).

- [ ] **Step 3: Commit**

```bash
git add apps/cms/server/api/graphql/graphql.test.ts
git commit -m "test(richtext): cover cmsLink references end-to-end

Confirms that cmsLink marks created via REST surface in body.references,
that the same target referenced by both an embed and a link is
deduplicated, and that the link allow-list is enforced at write time."
```

---

## Final Checks

- [ ] Run the full test suite: `pnpm test`
      Expected: all green.
- [ ] Run typecheck: `pnpm typecheck`
      Expected: no errors.
- [ ] Run lint + format: `pnpm lint && pnpm format`
      Expected: clean.
- [ ] Manual end-to-end smoke (if not already done in Task 5/7):
  - Create a content type with a RICHTEXT field, configure both allow-lists.
  - Create entries of the link-target type.
  - Open an entry editor, embed an entry, select text and add an entry link.
  - Save + republish. Reload and confirm round-trip.
  - Hit the GraphQL endpoint with `body { json references { __typename id ... on <Type> { slug } } }` and confirm both reference sources show up exactly once each.
