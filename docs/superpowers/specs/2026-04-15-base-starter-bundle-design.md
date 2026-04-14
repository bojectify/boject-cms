# Base Starter Bundle

## Overview

Ship a v1 "Base" starter bundle — a production-ready JSON content bundle defining the minimum set of content types any content-driven website needs (blog/pages/nav/SEO), importable via the existing `pnpm content:import` CLI into a fresh CMS instance.

This is the first tier in a planned layered model (base → sport-base → sport-specific). Only the base tier is in scope here.

**Scope:**

- One new file: `starters/base.boject.json` — 8 content types + 1 `SiteSettings` entry
- `starters/README.md` — documentation
- `starters/starters.test.ts` — shape regression test (reuses `validateBundle`)
- Minor vitest config + root README + CLAUDE.md updates

**Dependencies already shipped:**

- IMAGE field type + `/api/files/*` pipeline (PR #11)
- Content bundle CLI + portable mode (PR #10)

No new system work is required — this spec is purely content definition packaged as a JSON bundle.

**Locked decisions:**

- **Meta fields by convention** — `metaTitle`, `metaDescription`, `metaImage`, `canonicalUrl`, `noIndex` duplicated on page-type content types (`Article`, `Page`). No new system primitive.
- **Flat navigation** — no self-referencing `children` field. Nested nav is a user-added enhancement.
- **Schema + `SiteSettings` singleton only** — no other seed entries. Fresh install has types ready plus one `SiteSettings` entry with placeholder values.
- **No content blocks** — `Article` and `Page` bodies are richtext only. Users add block content types themselves if needed.

## Content Types

Eight content types. Notation: `IDENTIFIER type (required?)` — default `required: false` unless marked.

### `Image`

| identifier | name     | type        | req | notes                         |
| ---------- | -------- | ----------- | --- | ----------------------------- |
| `name`     | Name     | ENTRY_TITLE | ✓   | Display name in listings      |
| `file`     | File     | IMAGE       | ✓   | The uploaded image            |
| `alt`      | Alt text | TEXT        |     | Accessibility, screen readers |
| `credit`   | Credit   | TEXT        |     | Photographer / attribution    |
| `caption`  | Caption  | TEXTAREA    |     | Descriptive caption           |

Width, height, file size, focal point, storage key, and mime type are auto-populated from the IMAGE field's upload pipeline (Sharp processing + `ImageField.vue` defaults). Users never set them directly.

### `Tag`

| identifier | name | type        | req |
| ---------- | ---- | ----------- | --- |
| `name`     | Name | ENTRY_TITLE | ✓   |
| `slug`     | Slug | SLUG        |     |

### `Author`

| identifier | name     | type               | req |
| ---------- | -------- | ------------------ | --- |
| `name`     | Name     | ENTRY_TITLE        | ✓   |
| `slug`     | Slug     | SLUG               |     |
| `bio`      | Bio      | TEXTAREA           |     |
| `headshot` | Headshot | RELATION → `Image` |     |

### `Article`

| identifier        | name             | type                  | req | notes               |
| ----------------- | ---------------- | --------------------- | --- | ------------------- |
| `title`           | Title            | ENTRY_TITLE           | ✓   |                     |
| `slug`            | Slug             | SLUG                  |     |                     |
| `summary`         | Summary          | TEXTAREA              |     | Short teaser        |
| `body`            | Body             | RICHTEXT              |     | Tiptap doc          |
| `author`          | Author           | RELATION → `Author`   |     |                     |
| `tags`            | Tags             | MULTIRELATION → `Tag` |     |                     |
| `featuredImage`   | Featured image   | RELATION → `Image`    |     |                     |
| `metaTitle`       | Meta title       | TEXT                  |     | Overrides `<title>` |
| `metaDescription` | Meta description | TEXTAREA              |     |                     |
| `metaImage`       | Meta image       | RELATION → `Image`    |     | OG / social preview |
| `canonicalUrl`    | Canonical URL    | TEXT                  |     |                     |
| `noIndex`         | No index         | BOOLEAN               |     | Exclude from search |

### `Page`

| identifier        | name             | type               | req |
| ----------------- | ---------------- | ------------------ | --- |
| `title`           | Title            | ENTRY_TITLE        | ✓   |
| `slug`            | Slug             | SLUG               |     |
| `body`            | Body             | RICHTEXT           |     |
| `metaTitle`       | Meta title       | TEXT               |     |
| `metaDescription` | Meta description | TEXTAREA           |     |
| `metaImage`       | Meta image       | RELATION → `Image` |     |
| `canonicalUrl`    | Canonical URL    | TEXT               |     |
| `noIndex`         | No index         | BOOLEAN            |     |

### `SiteSettings`

| identifier       | name             | type               | req | notes                                        |
| ---------------- | ---------------- | ------------------ | --- | -------------------------------------------- |
| `name`           | Name             | ENTRY_TITLE        | ✓   | Convention: "Site Settings" on the singleton |
| `siteName`       | Site name        | TEXT               | ✓   | Brand name                                   |
| `logo`           | Logo             | RELATION → `Image` |     |                                              |
| `defaultOgImage` | Default OG image | RELATION → `Image` |     | Fallback when a page has no metaImage        |
| `footerCopy`     | Footer copy      | TEXTAREA           |     |                                              |

Singleton by convention. Consumers query `siteSettings(first: 1)` and take the first edge (matches the Contentful pattern). No system-level enforcement — documented in `starters/README.md`.

### `Navigation`

| identifier | name  | type                             | req |
| ---------- | ----- | -------------------------------- | --- |
| `name`     | Name  | ENTRY_TITLE                      | ✓   |
| `items`    | Items | MULTIRELATION → `NavigationItem` |     |

### `NavigationItem`

| identifier     | name            | type                           | req | notes                     |
| -------------- | --------------- | ------------------------------ | --- | ------------------------- |
| `label`        | Label           | ENTRY_TITLE                    | ✓   | Visible link text         |
| `url`          | URL             | TEXT                           |     | External or fallback      |
| `internalLink` | Internal link   | RELATION → `Article` \| `Page` |     | Multi-target, polymorphic |
| `openInNewTab` | Open in new tab | BOOLEAN                        |     |                           |

**Known limitation:** dynamic content types don't support cross-field conditional validation, so a `NavigationItem` with neither `url` nor `internalLink` set is allowed. Frontend is responsible for rendering such items as plain labels.

## Bundle Packaging

### File location

New top-level directory:

```
starters/
  base.boject.json       # v1 base starter (this spec)
  README.md              # what each starter contains, how to apply
  starters.test.ts       # shape regression test
```

Separate from `scripts/content-bundle/fixtures/` — fixtures are test-only; starters are promoted assets users and future scaffolders reach for.

### Bundle format

JSON, `portable: true`, same shape as existing content bundles. The bundle itself declares `"portable": true` in its payload, so no `--portable` flag is needed at import.

### Applying

```bash
pnpm content:import ./starters/base.boject.json
```

No new CLI command — the existing `content:import` handles this.

### Idempotency & conflict handling

The CLI already fails fast on `ContentType.identifier` / `(contentTypeId, slug)` / `(contentTypeId, entryTitle)` collision. Re-importing the base bundle into an instance that already has any of these types produces a clear error listing the offenders.

No `--force` or `--skip` flags in v1 (tracked as issue #30).

## SiteSettings Seed Entry

Exactly one entry ships in the base bundle:

```json
{
  "contentTypeIdentifier": "SiteSettings",
  "entryTitle": "Site Settings",
  "slug": null,
  "status": "PUBLISHED",
  "publishedAt": null,
  "data": {
    "name": "Site Settings",
    "siteName": "My Site",
    "logo": null,
    "defaultOgImage": null,
    "footerCopy": "© {{year}} My Site. All rights reserved."
  }
}
```

**Value notes:**

- `entryTitle` and `data.name` both set to `"Site Settings"`. The `entryTitle` column is synced from `data.name` by the API; the two-pass portable import writes both consistently.
- `status: "PUBLISHED"` — site configuration is live from first import. DRAFT would be an odd default for settings.
- `publishedAt: null` — `createdAt` / `updatedAt` are regenerated at import time. `publishedAt` stays null; settings are effectively "live on save."
- `siteName: "My Site"` — generic placeholder, user edits immediately after import.
- `logo` / `defaultOgImage` — `null`. No `Image` entry exists to reference. User uploads + sets these themselves.
- `footerCopy` — literal `{{year}}` placeholder. **Not** an interpolation system — just text the user edits. Documented in `starters/README.md` so users know to replace it.

## Tier Roadmap (Informational)

This spec ships **base** only. Noted here so future specs don't re-argue layering:

- **Base (this spec)** — any content-driven website. 8 content types, no vertical opinion.
- **Sport-base (future)** — on top of base. Adds Team, Club, Competition, Season, Fixture, Score, Player, Position, PlayerTeamHistory. Generic across rugby, football, cricket, etc.
- **Sport-specific (future)** — rugby variant adds rugby-only `ScoreType` values (TRY, CONVERSION, DROP_GOAL, PENALTY); football would differ (GOAL, OWN_GOAL, PENALTY_GOAL).

**Composition:**

- Each tier is its own bundle: `starters/base.boject.json`, `starters/sport-base.boject.json`, `starters/sport-rugby.boject.json`.
- Users apply them in order: `pnpm content:import starters/base.boject.json && pnpm content:import starters/sport-base.boject.json`.
- Each tier assumes prior tiers are present. `targetContentTypeIdentifiers` in a later tier resolves against types already in the DB. The README documents the expected order.
- No formal dependency metadata in v1. A missing-identifier reference fails import with a clear error. Formal `dependencies: ["base"]` metadata can land when a real use case appears.

**Deferred for future tier specs:** exact sport-base field lists, migration from existing rugby hardcoded Prisma models, any new field types sport requires (e.g. duration/interval for match length).

## Testing

One new test file:

- `starters/starters.test.ts` — picks up every `*.boject.json` under `starters/` and runs it through `validateBundle` from `scripts/content-bundle/validate.ts`. Mirrors the existing `fixtures.test.ts` pattern.

The existing "unit" Vitest project picks up `scripts/**/*.test.ts` via the vitest config. One-line update extends it to also match `starters/**/*.test.ts`.

**No end-to-end import test.** `scripts/content-bundle/roundtrip.test.ts` already covers export-import integrity for the bundle format. Re-running against the starter would either duplicate coverage or require a dedicated reset of the test DB — not worth the friction for this spec.

**Pre-merge checks:** `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` — all clean.

**Smoke test (manual, not automated):**

1. Drop DB: `docker compose down -v && docker compose up -d`
2. Run migrations + minimal seed (admin user + API key only — not the full rugby seed)
3. `pnpm content:import ./starters/base.boject.json`
4. Log in to CMS, verify all 8 content types appear in sidebar
5. Verify the `SiteSettings` entry exists with placeholder values
6. Create a sample `Article` referencing an `Author` + `Tag` + `Image` — confirms relation fields resolve correctly post-import

## Documentation

- **`starters/README.md`** — what the base starter provides (list the 8 types + the `SiteSettings` entry), how to apply, how to extend (modify JSON before import, or add fields via the CMS post-import), warning that importing into a non-empty CMS will fail, note that `{{year}}` in `footerCopy` is literal not interpolated, convention that `SiteSettings` is a singleton.
- **`CLAUDE.md`** — new bullet under "Content bundle CLI" pointing at `starters/` and noting it's distinct from `fixtures/`.
- **Root `README.md`** — one sentence in Getting Started after `pnpm prisma:migrate`: "Optionally apply the base starter bundle: `pnpm content:import ./starters/base.boject.json`".

## Out of Scope

Most of these already have tracking issues from the mine-the-specs sweep (#13–#41):

- Scaffolder integration (`create-boject-cms`-style tool)
- Multiple starter tiers (sport-base, rugby, football) — future specs
- UI for selecting/applying starters from within the CMS (issue #28)
- System-level singleton enforcement for `SiteSettings` (convention only for v1)
- Self-referencing RELATION targets for hierarchical content (would unblock nested nav — tracked implicitly via the flat-nav decision)
- Content blocks / page-builder model
- Cross-field conditional validation (would enforce "NavigationItem requires url OR internalLink")
- `{{year}}` interpolation (and any other string interpolation)
