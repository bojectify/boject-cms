# Base Starter Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `starters/base.boject.json` bundle defining 8 content types + 1 `SiteSettings` seed entry, applicable via `pnpm content:import ./starters/base.boject.json`.

**Architecture:** Pure content definition packaged as JSON. No new system work — all dependencies (IMAGE field, `/api/files/*` pipeline, content-bundle CLI, portable mode) are already shipped. A new top-level `starters/` directory holds the bundle plus a shape regression test that reuses the existing `validateBundle` from `scripts/content-bundle/validate.ts`.

**Tech Stack:** JSON bundle format (v1, portable), Vitest, existing `scripts/content-bundle/` module.

**Reference spec:** `docs/superpowers/specs/2026-04-15-base-starter-bundle-design.md`

---

## Task 1: Extend vitest config + write failing shape test

**Files:**

- Modify: `vitest.config.ts`
- Create: `starters/starters.test.ts`

**Context:** The existing vitest "unit" project matches `scripts/**/*.test.ts`. Extend it to also match `starters/**/*.test.ts` so our new test is picked up. The test itself mirrors the pattern from `scripts/content-bundle/fixtures/fixtures.test.ts` — read every `*.boject.json` from the directory and pass it through `validateBundle`. At this point no bundle exists, so the test will fail with a "file not found" error.

- [ ] **Step 1: Extend vitest config unit project glob**

Open `vitest.config.ts`. In the `projects` array, the `unit` project currently has `include: ['scripts/**/*.test.ts']`. Change to include starters too:

```ts
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['scripts/**/*.test.ts', 'starters/**/*.test.ts'],
          globals: true,
        },
      },
```

- [ ] **Step 2: Create `starters/starters.test.ts`**

Create `starters/starters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../scripts/content-bundle/validate';

const here = new URL('.', import.meta.url).pathname;

const bundleFiles = readdirSync(here).filter((f) => f.endsWith('.boject.json'));

describe('starters', () => {
  it('finds at least one starter bundle', () => {
    expect(bundleFiles.length).toBeGreaterThan(0);
  });

  it.each(bundleFiles)('%s passes validateBundle', (filename) => {
    const raw = readFileSync(join(here, filename), 'utf8');
    const bundle = JSON.parse(raw);
    const result = validateBundle(bundle);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `pnpm test starters/starters.test.ts`

Expected: The `finds at least one starter bundle` assertion fails because `bundleFiles.length === 0`. No `*.boject.json` files exist in `starters/` yet.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts starters/starters.test.ts
git commit -m "test(starters): add shape regression test for bundles under starters/"
```

The commit must pass pre-commit hooks cleanly. No `--no-verify`.

Note on the test failing at commit time: Lefthook's pre-commit hook runs `format`, `lint`, and `typecheck`, but **not** `test`. The failing test will be committed in this task and made to pass in Task 2 — same TDD pattern used throughout the codebase's other plans.

---

## Task 2: Create the base starter bundle

**Files:**

- Create: `starters/base.boject.json`

**Context:** This is the main deliverable — a single JSON file containing 8 content types and one `SiteSettings` seed entry. The shape is a portable bundle (`"portable": true`, all `id` fields set to `null`). The existing bundle format is documented in `scripts/content-bundle/types.ts` and exemplified in `scripts/content-bundle/fixtures/with-relations.boject.json`.

Field ordering on each content type follows this convention: ENTRY_TITLE first (always `order: 0`), SLUG second if present, main-body fields next, relation fields after, meta fields last. The `order` integer is sequential starting at 0 and has no gaps.

RELATION and MULTIRELATION fields in portable mode use `options.targetContentTypeIdentifiers` (array of identifier strings) and set `options.targetContentTypeIds` to `[null, ...]` of the same length — the bundle-import path resolves identifiers to UUIDs at import time. See `scripts/content-bundle/fixtures/with-relations.boject.json` for the exact pattern.

- [ ] **Step 1: Create `starters/base.boject.json`**

Create `starters/base.boject.json` with exactly this content:

```json
{
  "version": 1,
  "exportedAt": "2026-04-15T00:00:00.000Z",
  "portable": true,
  "contentTypes": [
    {
      "id": null,
      "identifier": "Image",
      "name": "Image",
      "description": "A reusable image asset with editorial metadata.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "file",
          "name": "File",
          "type": "IMAGE",
          "required": true,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "alt",
          "name": "Alt text",
          "type": "TEXT",
          "required": false,
          "order": 2,
          "options": null
        },
        {
          "id": null,
          "identifier": "credit",
          "name": "Credit",
          "type": "TEXT",
          "required": false,
          "order": 3,
          "options": null
        },
        {
          "id": null,
          "identifier": "caption",
          "name": "Caption",
          "type": "TEXTAREA",
          "required": false,
          "order": 4,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "Tag",
      "name": "Tag",
      "description": "A categorisation tag used by content entries.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "Author",
      "name": "Author",
      "description": "A content author with bio and headshot.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "bio",
          "name": "Bio",
          "type": "TEXTAREA",
          "required": false,
          "order": 2,
          "options": null
        },
        {
          "id": null,
          "identifier": "headshot",
          "name": "Headshot",
          "type": "RELATION",
          "required": false,
          "order": 3,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        }
      ]
    },
    {
      "id": null,
      "identifier": "Article",
      "name": "Article",
      "description": "An editorial article with rich text body, author, tags, and SEO metadata.",
      "fields": [
        {
          "id": null,
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "summary",
          "name": "Summary",
          "type": "TEXTAREA",
          "required": false,
          "order": 2,
          "options": null
        },
        {
          "id": null,
          "identifier": "body",
          "name": "Body",
          "type": "RICHTEXT",
          "required": false,
          "order": 3,
          "options": null
        },
        {
          "id": null,
          "identifier": "author",
          "name": "Author",
          "type": "RELATION",
          "required": false,
          "order": 4,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Author"]
          }
        },
        {
          "id": null,
          "identifier": "tags",
          "name": "Tags",
          "type": "MULTIRELATION",
          "required": false,
          "order": 5,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Tag"]
          }
        },
        {
          "id": null,
          "identifier": "featuredImage",
          "name": "Featured image",
          "type": "RELATION",
          "required": false,
          "order": 6,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "metaTitle",
          "name": "Meta title",
          "type": "TEXT",
          "required": false,
          "order": 7,
          "options": null
        },
        {
          "id": null,
          "identifier": "metaDescription",
          "name": "Meta description",
          "type": "TEXTAREA",
          "required": false,
          "order": 8,
          "options": null
        },
        {
          "id": null,
          "identifier": "metaImage",
          "name": "Meta image",
          "type": "RELATION",
          "required": false,
          "order": 9,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "canonicalUrl",
          "name": "Canonical URL",
          "type": "TEXT",
          "required": false,
          "order": 10,
          "options": null
        },
        {
          "id": null,
          "identifier": "noIndex",
          "name": "No index",
          "type": "BOOLEAN",
          "required": false,
          "order": 11,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "Page",
      "name": "Page",
      "description": "A standalone page with rich text body and SEO metadata.",
      "fields": [
        {
          "id": null,
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "body",
          "name": "Body",
          "type": "RICHTEXT",
          "required": false,
          "order": 2,
          "options": null
        },
        {
          "id": null,
          "identifier": "metaTitle",
          "name": "Meta title",
          "type": "TEXT",
          "required": false,
          "order": 3,
          "options": null
        },
        {
          "id": null,
          "identifier": "metaDescription",
          "name": "Meta description",
          "type": "TEXTAREA",
          "required": false,
          "order": 4,
          "options": null
        },
        {
          "id": null,
          "identifier": "metaImage",
          "name": "Meta image",
          "type": "RELATION",
          "required": false,
          "order": 5,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "canonicalUrl",
          "name": "Canonical URL",
          "type": "TEXT",
          "required": false,
          "order": 6,
          "options": null
        },
        {
          "id": null,
          "identifier": "noIndex",
          "name": "No index",
          "type": "BOOLEAN",
          "required": false,
          "order": 7,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "SiteSettings",
      "name": "Site Settings",
      "description": "Site-wide configuration. Singleton by convention — only one entry.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "siteName",
          "name": "Site name",
          "type": "TEXT",
          "required": true,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "logo",
          "name": "Logo",
          "type": "RELATION",
          "required": false,
          "order": 2,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "defaultOgImage",
          "name": "Default OG image",
          "type": "RELATION",
          "required": false,
          "order": 3,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "footerCopy",
          "name": "Footer copy",
          "type": "TEXTAREA",
          "required": false,
          "order": 4,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "Navigation",
      "name": "Navigation",
      "description": "A named navigation tree (e.g. Main, Footer).",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "items",
          "name": "Items",
          "type": "MULTIRELATION",
          "required": false,
          "order": 1,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["NavigationItem"]
          }
        }
      ]
    },
    {
      "id": null,
      "identifier": "NavigationItem",
      "name": "Navigation item",
      "description": "A single link inside a Navigation. Either url or internalLink should be set.",
      "fields": [
        {
          "id": null,
          "identifier": "label",
          "name": "Label",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "url",
          "name": "URL",
          "type": "TEXT",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "internalLink",
          "name": "Internal link",
          "type": "RELATION",
          "required": false,
          "order": 2,
          "options": {
            "targetContentTypeIds": [null, null],
            "targetContentTypeIdentifiers": ["Article", "Page"]
          }
        },
        {
          "id": null,
          "identifier": "openInNewTab",
          "name": "Open in new tab",
          "type": "BOOLEAN",
          "required": false,
          "order": 3,
          "options": null
        }
      ]
    }
  ],
  "entries": [
    {
      "id": null,
      "contentTypeId": null,
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
  ]
}
```

- [ ] **Step 2: Run the shape regression test**

Run: `pnpm test starters/starters.test.ts`

Expected: 2 tests pass — `finds at least one starter bundle` and `base.boject.json passes validateBundle`.

- [ ] **Step 3: Format check**

Run: `pnpm prettier --check starters/base.boject.json`

Expected: Prettier accepts the file without flagging formatting issues. If it flags anything, run `pnpm prettier --write starters/base.boject.json` and verify the test still passes afterward.

- [ ] **Step 4: Commit**

```bash
git add starters/base.boject.json
git commit -m "feat(starters): add base starter bundle (8 content types + SiteSettings entry)"
```

Commit must pass pre-commit hooks cleanly. No `--no-verify`.

---

## Task 3: Create `starters/README.md`

**Files:**

- Create: `starters/README.md`

**Context:** Human-facing documentation for the starters directory. Explains what each starter provides, how to apply, how to extend. This is the primary reference for anyone using the starters — not the design spec.

- [ ] **Step 1: Create `starters/README.md`**

Create `starters/README.md` with:

```markdown
# Starter bundles

Production-ready content type bundles for `pnpm content:import`. Apply these to a fresh CMS instance to get a working baseline without hand-configuring content types.

## Available starters

### `base.boject.json`

The minimum set any content-driven website needs:

- **Image** — uploaded image with `alt`, `credit`, `caption` (file metadata auto-populated by the IMAGE field)
- **Tag** — `name` + `slug`
- **Author** — `name`, `slug`, `bio`, `headshot`
- **Article** — `title`, `slug`, `summary`, `body` (richtext), `author`, `tags`, `featuredImage`, plus SEO fields (`metaTitle`, `metaDescription`, `metaImage`, `canonicalUrl`, `noIndex`)
- **Page** — `title`, `slug`, `body` (richtext), plus the same SEO fields
- **SiteSettings** — `siteName`, `logo`, `defaultOgImage`, `footerCopy` (singleton by convention)
- **Navigation** — `name` + `items` (flat list of `NavigationItem`)
- **NavigationItem** — `label`, `url`, `internalLink` (to Article or Page), `openInNewTab`

Plus one seed entry: a single `SiteSettings` instance with placeholder values.

## Applying a starter

From a fresh CMS instance (no existing content types with matching identifiers):

\`\`\`bash
pnpm content:import ./starters/base.boject.json
\`\`\`

The CLI fails fast if any identifier, slug, or entry title collides with existing data — apply to an empty instance.

## Conventions

- **SiteSettings is a singleton.** The starter creates exactly one entry. Consumers should query `siteSettings(first: 1) { edges { node { ... } } }` and use the first result. Do not create additional `SiteSettings` entries.
- **`{{year}}` in `footerCopy` is literal text.** The starter does not interpolate it. Edit the entry in the CMS after import to replace it with the current year (or a dynamic year in your frontend renderer).
- **Navigation is flat.** `NavigationItem` has no `children` field. Nested navigation would require self-referencing RELATION targets, which the current bundle-import path doesn't support. Users who need a tree can add a `children: MULTIRELATION → NavigationItem` field in the CMS after import.
- **`NavigationItem` allows both `url` and `internalLink` to be empty** because the dynamic content type system doesn't support cross-field conditional validation. Items with neither set render as plain labels at the frontend.

## Extending

Two ways to extend the base:

1. **Edit the JSON before import** — add fields, change defaults, drop types you don't need. Re-run `pnpm content:validate ./starters/base.boject.json` before importing to catch shape errors.
2. **Import and edit in the CMS** — import the base, then add/remove fields via the content-types UI.

## Tiered starters (future)

The base starter is the first tier in a planned layered model:

- **base** (this starter) — any content-driven website
- **sport-base** — base + `Team`, `Club`, `Competition`, `Season`, `Fixture`, `Player`, etc.
- **sport-{rugby,football,etc.}** — sport-base + sport-specific enums

Later tiers assume prior tiers are already imported. Apply them in order.

## Testing

`starters.test.ts` runs every `*.boject.json` under this directory through `validateBundle` from `scripts/content-bundle/validate.ts`. This catches shape drift as the bundle format evolves. Run it via `pnpm test starters/starters.test.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add starters/README.md
git commit -m "docs(starters): document base starter + usage conventions"
```

---

## Task 4: Update root `README.md` + `CLAUDE.md`

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`

**Context:** Light touches to the two top-level docs so developers discover the starter from either entry point.

- [ ] **Step 1: Update root `README.md` Getting Started section**

Open `README.md`. Find the Getting Started section — it should contain a sequence of shell commands that sets up a fresh dev environment (`pnpm install`, `cp .env.example .env`, `pnpm prisma:migrate`, `pnpm prisma:seed`, `pnpm dev`).

After the `pnpm prisma:migrate` line and before `pnpm dev`, add one line:

```bash
# Optionally apply the base starter bundle
pnpm content:import ./starters/base.boject.json
```

If there's a comment block or numbered step, match the surrounding style. The goal is one extra step between migrations and dev server start.

- [ ] **Step 2: Update `CLAUDE.md` Architecture section**

Open `CLAUDE.md`. Find the bullet point that documents the content-bundle CLI (search for "Content bundle CLI" or `scripts/content-bundle`).

Immediately after that bullet, add a new bullet:

```
- **Starter bundles** — `starters/` at the repo root holds production-ready JSON bundles applied via `pnpm content:import`. `starters/base.boject.json` defines the 8 content types every content-driven website needs (Image, Tag, Author, Article, Page, SiteSettings, Navigation, NavigationItem) plus one SiteSettings seed entry. Distinct from `scripts/content-bundle/fixtures/`, which holds test-only bundles. See `starters/README.md` for usage and conventions.
```

- [ ] **Step 3: Update `CLAUDE.md` Key Files list**

In `CLAUDE.md`, find the "Key Files" section. Add three entries anywhere in the list (the list isn't alphabetised — add near other content-bundle entries if you can find them):

```
- `starters/base.boject.json` — v1 base starter bundle (8 content types + SiteSettings entry)
- `starters/README.md` — starter bundle documentation + usage conventions
- `starters/starters.test.ts` — shape regression test for every bundle under `starters/`
```

- [ ] **Step 4: Format check**

Run: `pnpm format`

Expected: No formatting issues. If Prettier flags either file, run `pnpm format:fix`.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: point to starters/ from root README and CLAUDE.md"
```

Commit must pass hooks cleanly. No `--no-verify`.

---

## Task 5: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`

Expected: Exit 0, no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: Exit 0, no errors.

- [ ] **Step 3: Format check**

Run: `pnpm format`

Expected: `All matched files use Prettier code style!`. If `.claude/settings.local.json` is flagged (it's host-local and gitignored but not in `.prettierignore`), run `pnpm prettier --write .claude/settings.local.json` to unblock.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`

Expected: All tests pass. New: `starters/starters.test.ts` contributes 2 tests. Existing tests unaffected.

- [ ] **Step 5: Validate bundle via the CLI**

Run: `pnpm content:validate ./starters/base.boject.json`

Expected: `Bundle is valid`, exit 0. This is a secondary check — the regression test already exercises `validateBundle`, but the CLI path proves the end-to-end tool works against the real file.

- [ ] **Step 6: (Optional) Manual smoke test**

This step is manual and requires a fresh DB. Skip if the implementer isn't in a position to reset the local DB; the automated checks above prove the bundle is shape-correct. To run:

1. Reset DB:
   ```bash
   docker compose down -v && docker compose up -d
   ```
2. Wait a few seconds for Postgres to accept connections.
3. Run migrations:
   ```bash
   pnpx prisma migrate deploy
   ```
4. Minimal seed (admin user + API key only — NOT the full rugby seed which conflicts with the starter's identifiers):
   ```bash
   pnpm apikey:create starter-smoke-test
   # Manually insert an admin user via `pnpm prisma:studio`, or re-run
   # `pnpm prisma:seed` and accept the rugby example data alongside.
   ```
5. Apply the starter:
   ```bash
   pnpm content:import ./starters/base.boject.json
   ```
   Expected output: `Imported 8 content type(s) and 1 entry/entries`.
6. Start the dev server:
   ```bash
   pnpm dev
   ```
7. Log in, confirm the sidebar lists all 8 starter content types, open the `SiteSettings` entry and confirm it shows `siteName: "My Site"` and the placeholder footer copy.
8. Reset the DB back to its previous state before continuing any other work.

- [ ] **Step 7: Commit nothing if the suite passes**

This task has no file changes. If Steps 1–5 all pass, the task is complete — no commit needed.

---

## Plan Complete

All tasks:

1. Extend vitest config + failing shape test
2. Create the base starter bundle
3. Create `starters/README.md`
4. Update root `README.md` + `CLAUDE.md`
5. Final verification
