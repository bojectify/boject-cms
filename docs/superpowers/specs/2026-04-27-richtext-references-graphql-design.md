# RichText GraphQL with embedded + linked entries

**Status:** Design
**Date:** 2026-04-27
**Related:** `2026-04-13-richtext-field-type-design.md`, `2026-04-24-richtext-inline-embeds-design.md`

## Problem

RICHTEXT fields are currently exposed in GraphQL as a bare `JSON` scalar — clients receive the ProseMirror document including `cmsEmbed` atom nodes that carry `{ contentTypeId, entryId, contentTypeIdentifier }` references. To resolve the embed targets into renderable content (titles, slugs, related fields), consumers must issue one follow-up GraphQL query per referenced entry. This is N+1 in the wrong place — at the network boundary, paid for by every page view.

In addition, RICHTEXT today supports inline embeds but has no notion of an entry-typed hyperlink. The existing Tiptap `Link` mark only stores external URLs; an editor cannot create a link whose target is a CMS entry (e.g. a `NavigationItem` body linking to a `Page`).

## Goals

1. Allow consumers to fetch a RICHTEXT field plus all of its referenced entries in a single GraphQL request, with full fragment narrowing per content type and arbitrarily deep relation traversal.
2. Add entry-targeted hyperlinks to the rich text editor as a first-class primitive distinct from external URL links.
3. Surface both embeds and entry links through the same GraphQL surface — clients shouldn't need to know the difference at the query layer.

## Non-goals

- CMS-side resolved `href` strings on link marks. Sites have wildly divergent URL schemes and the CMS will not bake one in.
- Splitting embedded references into `block` vs `inline` arrays in GraphQL. The ProseMirror tree already encodes placement structurally; renderers disambiguate by walking the doc.
- Per-field generated unions in GraphQL (e.g. `ArticleBodyEmbedUnion = Image | Tag`). Allow-list enforcement happens at write time; spreading a fragment for a non-allow-listed type is harmless.
- Modifying the existing Tiptap `Link` mark or its toolbar button. External URL links continue to work exactly as today.

## Design

### GraphQL schema

RICHTEXT fields are no longer exposed as a `JSON` scalar. They become a shared `RichText` object type registered once in `dynamicTypes.ts` and reused across every RICHTEXT field on every content type:

```graphql
type RichText {
  json: JSON!
  references: [ContentEntry!]!
}
```

- `json` — the ProseMirror document, byte-identical to today's RICHTEXT scalar value.
- `references` — the deduplicated set of `ContentEntry` instances referenced anywhere in the body, via `cmsEmbed` nodes and `cmsLink` marks combined.

Because `ContentEntry` is the existing shared interface that every dynamic content type already implements (`dynamicTypes.ts:103-132`), consumers spread per-type fragments and traverse relations to arbitrary depth in the standard Pothos/Relay style:

```graphql
body {
  json
  references {
    __typename
    id
    ... on Page { slug fullPath }
    ... on Fixture {
      slug
      team { slug competition { slug } }
    }
    ... on Article { slug }
  }
}
```

A fragment for a content type that is not in the field's allow-list (or that the document does not actually reference) simply never matches — degrading gracefully to "drops the item" rather than 400-ing.

### `references` resolver

The resolver runs once per RICHTEXT field per entry response. Steps:

1. Walk the body's ProseMirror tree once, collecting every `(contentTypeId, entryId)` pair encountered on `cmsEmbed` node attrs **or** `cmsLink` mark attrs. Order is document-traversal order; ordering inside `references` is not contractual — clients look up by `id`.
2. Deduplicate `(contentTypeId, entryId)` pairs.
3. One `prisma.contentEntry.findMany({ where: { id: { in: [...] } }, include: { versions: { where: { status: 'PUBLISHED' } } } })`.
4. Drop entries with no PUBLISHED version. Drop entries whose `contentTypeId` is not in the schema's `typeIdToIdentifier` map (deleted content type — fail open).
5. Flatten each surviving row through the existing `flattenToShape(entry, version)` helper to produce `ContentEntryShape` values that the interface's `resolveType` can dispatch on.

The walker lives in a new server util alongside the existing `enrichRichtextEmbeds.ts` family — likely `apps/cms/server/utils/collectRichtextReferences.ts` — and is unit tested independently of the resolver.

### Editor: new `cmsLink` Tiptap mark

A new Tiptap mark, separate from Tiptap StarterKit's `Link`. The existing `Link` mark continues to handle external URLs unchanged.

- Mark name: `cmsLink`.
- Attributes: `{ contentTypeId: string, entryId: string, contentTypeIdentifier?: string }`. `contentTypeIdentifier` is stamped server-side on save (mirroring how `cmsEmbed` works today).
- Inclusivity: same as Tiptap's default `Link` — applies to a span of text.
- Toolbar: a new "Link to entry" button registered alongside the existing "Link" button. Clicking opens the existing `EntryPickerModal`, scoped to the field's `linkTargetContentTypeIds` allow-list.
- Conditional registration: the mark is only registered on a `RichTextEditor` instance when the field's `linkTargetContentTypeIds` is non-empty. An empty/missing allow-list disables the feature for that field, mirroring the existing `cmsEmbed` registration logic.
- Node view (rendering): a Vue node view (parallel to `CmsEmbedNodeView.vue`) that resolves the reference via `useRelationResolver` and renders the wrapped text plus a small content-type chip / status indicator. No URL is computed in the editor.

### Field config: two allow-lists

`ContentTypeField.options` for RICHTEXT fields gains a new sibling key:

- `targetContentTypeIds: string[]` — embed allow-list (unchanged).
- `linkTargetContentTypeIds: string[]` — entry-link allow-list (new).

Both default to undefined / empty, which disables the corresponding feature for that field. The two lists are independent: editors can permit `Image | Tag | PullQuote` to be embedded while permitting `Page | Article` to be linked.

The existing `FieldModal` `#type-options` slot for RICHTEXT grows a second `ContentTypeChipPicker` labelled "Allowed link targets" beneath the existing "Allowed embed targets" picker.

### Validator + persistence

`apps/cms/server/utils/validateEntryData.ts` (or its RICHTEXT-specific helper, depending on current factoring) extends its body walker to also visit `cmsLink` marks. Rejection rules:

- A `cmsEmbed` node whose `contentTypeId` is not in the field's `targetContentTypeIds`: 400.
- A `cmsLink` mark whose `contentTypeId` is not in the field's `linkTargetContentTypeIds`: 400.
- `cmsLink` mark missing required `contentTypeId` or `entryId`: 400.

`apps/cms/server/utils/enrichRichtextEmbeds.ts` extends to walk both `cmsEmbed` nodes and `cmsLink` marks and stamp `contentTypeIdentifier` onto each one's attrs from the same identifier map. Same identifier-immutability dependency the embed feature already relies on (#112). Function naming may benefit from a small rename (`enrichRichtextReferences`) to reflect the broader scope; the existing `enrichBodyWithContentTypeIdentifiers` recursion can stay generic — the per-node decision is what changes.

### Schema rebuild trigger

No new trigger required. `RichText` is a static shape; only the contents of `references` vary per request. The existing `invalidateSchema()` calls on ContentType mutations remain sufficient because dynamic-type registration only changes when content types or their fields change.

### Migration

`registerDynamicTypes` currently maps `RICHTEXT` through `FIELD_TYPE_TO_SCALAR` to the `JSON` scalar (`dynamicTypes.ts:86`). The RICHTEXT entry is removed from `FIELD_TYPE_TO_SCALAR`, and a new `richtextFields` loop registers each RICHTEXT field as `t.field({ type: RichTextRef, … })` with a resolver that returns `{ json: rawDocValue, contentTypeId: <owner>, fieldIdentifier: <name> }` so the `references` resolver can find the doc again. (The exact carrier shape is a small Pothos detail; the public schema shape is `RichText`.)

This is a breaking change for any GraphQL consumer reading RICHTEXT fields today. Since boject is pre-release, this is acceptable. Documented migration: rename `body` to `body { json }` to recover existing behaviour.

### Out of scope

- CMS-side resolved `href` per linked entry.
- Splitting `references` by source kind (embed vs link) in GraphQL.
- Per-field schema-encoded unions for embed/link targets.
- Inline link-mark editing UX changes to the existing Tiptap `Link`.

## Testing

- **Unit (`apps/cms/server/utils/collectRichtextReferences.test.ts`)** — walker correctly finds `cmsEmbed` and `cmsLink` references in nested content arrays, deduplicates `(contentTypeId, entryId)` pairs, ignores non-reference nodes/marks.
- **Unit (`apps/cms/server/utils/enrichRichtextEmbeds.test.ts`)** — link marks get `contentTypeIdentifier` stamped on save; missing identifier (deleted type) leaves attrs untouched.
- **Unit (`apps/cms/server/utils/validateEntryData.test.ts`)** — rejects out-of-allow-list embeds and links; accepts valid combinations; honours each allow-list independently.
- **Integration (`apps/cms/server/api/graphql/graphql.test.ts`)** — query a RICHTEXT field, assert `json` matches the saved doc and `references` returns the expected `ContentEntry` set with `__typename` correctly resolved, with fragment-narrowed nested relation traversal exercised end-to-end. Cover: embed-only, link-only, mixed, deduplication when the same entry is referenced multiple times, dropped non-published entries, dropped deleted-type entries.
- **Integration (`apps/cms/server/api/content-entries/content-entries.test.ts`)** — POST/PUT entry with `cmsLink` marks honouring `linkTargetContentTypeIds`; rejection on out-of-allow-list link target.

## Open questions

None outstanding — all major shape decisions resolved during brainstorming.
