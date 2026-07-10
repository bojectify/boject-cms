# Starter bundles

Production-ready content type bundles for `pnpm content:import`. Apply these to a fresh CMS instance to get a working baseline without hand-configuring content types.

## Vocabulary

- **Starter** — a selectable bundle. What `create-boject-cms` prompts for and what you point `pnpm content:import` at directly. Starters form a chain: each one extends the previous, adding content types on top.
- **Module** — a non-selectable, reusable bundle of content types shared by multiple starters via `extends`. Modules live under `starters/src/modules/` and are never offered as a top-level choice — they only exist to be extended.
- **Field-partial** — a reusable named group of fields, shared by multiple content types (in the same or different starters) via a content-type-level `extends`. Field-partials live under `starters/src/partials/` and contribute fields, not whole content types.

All three compose through an `extends` array: a starter overlay's top-level `extends` names parent starters/modules; a content type's own `extends` names field-partials.

## Available starters

Applying a starter gives you its content types **plus everything the starters/modules before it in the chain contribute** — each is not a standalone tier, it's the sum of the chain up to that point.

### `web-base.boject.json`

The minimum set any content-driven website needs:

- **Image** — uploaded image with `alt`, `credit`, `caption` (file metadata auto-populated by the IMAGE field)
- **SiteSettings** — `siteName`, `logo`, `defaultOgImage`, `footerCopy` (singleton by convention)
- **Link** — `label`, `url`, `openInNewTab` — a reusable link, usable anywhere in the site
- **NavigationItem** — `label`, a single `link` (RELATION → Link) and/or a `links` list (MULTIRELATION → Link)
- **Navigation** — `name` + `items` (MULTIRELATION → NavigationItem)

Plus one seed entry: a single `SiteSettings` instance with placeholder values.

This is the base of the chain — every other starter extends it (directly or transitively).

### `articles.boject.json`

Web Base + the **Taxonomy** module + editorial content types:

- Everything from Web Base
- **Tag** — `name` + `slug` (from the `taxonomy` module)
- **Category** — `name`, `slug`, `description` (from the `taxonomy` module)
- **Author** — `name`, `slug`, `bio`, `headshot`
- **Page** — `title`, `slug`, `body` (richtext), plus the `web-metadata` field-partial (SEO fields)
- **Article** — `title`, `slug`, `summary`, `body` (richtext), `author`, `tags`, `category`, `featuredImage`, plus `web-metadata`
- **Link** is patched to add `internalLink` (RELATION → Article or Page), so nav items and links can point at editorial content

`extends: ["web-base", "taxonomy"]`.

### `sport.boject.json`

Articles + sport/club structure:

- Everything from Articles (and transitively Web Base)
- **Team** — `name`, `slug`, `description`, plus `web-metadata` (an internal club squad, e.g. 1st XV)
- **Club** — `name`, `slug`, `crest` (an external opponent club)
- **Season** — `name`, `startDate`, `endDate`
- **Competition** — `name`, `slug`, `season`, `teams`
- **Fixture** — `matchup`, `team`, `opponent`, `competition`, `season`, `kickoff`, `isHome`, plus `web-metadata`
- **Player** — `name`, `slug`, `bio`, `headshot`, `team`, plus `web-metadata`

`extends: ["articles"]`.

### `rugby.boject.json`

Sport + rugby-specific structure:

- Everything from Sport (and transitively Articles, Web Base)
- **Position** — `name`, `slug`, `abbreviation` (e.g. Fly-half, Hooker)
- **Player** is patched to add `position` (RELATION → Position)

`extends: ["sport"]`.

## Modules

Modules are reusable content-type bundles that are never selected directly — they exist only to be `extends`-ed by starters.

### `src/modules/taxonomy.boject.json`

- **Tag** — `name` + `slug`
- **Category** — `name`, `slug`, `description`

Extended by Articles (and therefore Sport and Rugby).

## Field-partials

Field-partials are reusable field groups referenced by a content type's own `extends` array (distinct from an overlay's top-level `extends`, which names parent starters/modules). Their fields are appended after the content type's own fields.

### `src/partials/web-metadata.json`

The standard SEO/metadata field group:

- `metaTitle` (TEXT)
- `metaDescription` (TEXTAREA)
- `metaImage` (RELATION → Image)
- `canonicalUrl` (TEXT)
- `noIndex` (BOOLEAN, default `false`)

Used by `Page`, `Article` (Articles), `Team`, `Fixture`, `Player` (Sport, and inherited by Rugby).

## Navigation structure

`Navigation` holds an ordered `items` list of `NavigationItem`s. Each `NavigationItem` carries a `label` plus a single `link` and/or a `links` list, each pointing at a `Link` — a small reusable content type with its own `url` and `openInNewTab`. Once Articles (or a starter built on it) is applied, `Link` gains an `internalLink` field so links can target an `Article` or `Page` instead of (or as well as) an external URL.

Nesting is flat by design: `NavigationItem` has no self-referencing `children` field. Nested navigation would require self-referencing RELATION targets, which the current bundle-import path doesn't support. Users who need a tree can add a `children: MULTIRELATION → NavigationItem` field in the CMS after import.

## Applying a starter

How you apply a starter depends on whether you're working **in a project you scaffolded** with `create-boject-cms` or **inside this monorepo**.

### In a scaffolded project (the common case)

`create-boject-cms` copies the starter you pick into your project as `content-types/schema.boject.json` and points `BOJECT_SCHEMA_DIR` at it, so **the starter's content types are applied automatically on every boot** — you run nothing. On first boot against an empty database, the starter's seed entries (e.g. the `SiteSettings` singleton) are imported too.

To apply a starter — or a schema lifted from a similar project — to an **already-running** CMS, use the [`boject` CLI](../packages/boject-cli/README.md). It reads `.boject.config.json` for the CMS URL and `BOJECT_API_KEY` from the environment:

```bash
boject schema validate                 # offline shape check of content-types/schema.boject.json
boject schema apply                    # push it to the running CMS (add --dry-run to preview)
boject schema apply ./other.boject.json   # apply an arbitrary bundle file instead
```

`boject schema pull` does the reverse — it writes a running CMS's live schema to `content-types/schema.boject.json`. That's how you lift a content model **out of** a similar project: `pull` from that project's CMS, drop the file into your own `content-types/` (or point `boject schema apply` at it), then `git diff` and reconcile.

> **`schema apply` is schema-only.** It creates, updates, and (with `--allow-destructive`) removes content types, but it does **not** import entries — so a starter's seed entries (the `SiteSettings` singleton) don't ride along. Seed entries land only on a project's first boot (empty DB) or via `boject entries import`.

### In this monorepo (contributors)

`pnpm content:import` applies a starter — **schema and entries together** — to the local dev CMS:

```bash
pnpm content:import ./starters/web-base.boject.json
# or, further along the chain:
pnpm content:import ./starters/articles.boject.json
pnpm content:import ./starters/sport.boject.json
pnpm content:import ./starters/rugby.boject.json
```

The CLI fails fast if any identifier, slug, or entry title collides with existing data — apply to an empty instance. Each built starter already contains everything its parents contribute, so you only ever import **one** file — never chain `content:import` calls across starters.

## Use as schema-as-code source

The same JSON files in this directory are valid `BOJECT_SCHEMA_DIR` content.
When you scaffold a project with `create-boject-cms`, the chosen starter is
copied byte-for-byte into `<project>/content-types/schema.boject.json` and
becomes the source of truth for the project's schema going forward.

## Conventions

- **SiteSettings is a singleton.** The starter creates exactly one entry. Consumers should query `siteSettings(first: 1) { edges { node { ... } } }` and use the first result. Do not create additional `SiteSettings` entries.
- **`{{year}}` in `footerCopy` is literal text.** The starter does not interpolate it. Edit the entry in the CMS after import to replace it with the current year (or a dynamic year in your frontend renderer).
- **Navigation is flat.** See "Navigation structure" above.
- **`NavigationItem` allows `link` and `links` to both be empty** because the dynamic content type system doesn't support cross-field conditional validation. Items with neither set render as plain labels at the frontend.

## Extending

Two ways to extend a starter:

1. **Edit the JSON before import** — add fields, change defaults, drop types you don't need. Re-run `pnpm content:validate ./starters/<name>.boject.json` before importing to catch shape errors.
2. **Import and edit in the CMS** — import the starter, then add/remove fields via the content-types UI.

## Testing

`apps/cms/scripts/build-starters/starters-shape.test.ts` runs every `*.boject.json` under this directory (including `modules/`) through `validateBundle` from `apps/cms/scripts/content-bundle/validate.ts`. This catches shape drift as the bundle format evolves. Run it via `pnpm --filter cms test:unit`.

## Overlay system

`web-base.boject.json` and `src/modules/taxonomy.boject.json` are authored directly. `articles.boject.json`, `sport.boject.json`, and `rugby.boject.json` are **built** from small overlay files under `starters/src/overlays/` — they should not be edited by hand.

An overlay declares one or more parent bundles via `extends` (a starter or module name, or an array of names) and a list of content-type changes. Each change has a `mode`:

- `create` — add a brand-new content type. Fails if the identifier already exists in the parent chain. Requires `name` and exactly one `ENTRY_TITLE` field. May itself carry a content-type-level `extends` array naming field-partials, whose fields are appended after the content type's own fields.
- `patch` — modify an existing content type. Fields are matched by `identifier`; matching fields are replaced wholesale (including their `type`); new fields are appended. New `ENTRY_TITLE`/`SLUG` fields cannot be introduced via patch.

When an overlay's `extends` array names more than one parent (e.g. Articles extends both `web-base` and `taxonomy`), the parents are composed left-to-right before the overlay's own content-type changes are applied; a content type identifier appearing in more than one parent is a build-time error.

### Build

```bash
pnpm starters:build   # read src/overlays/*.overlay.json + src/partials/*.json, write *.boject.json outputs
pnpm starters:check   # rebuild in memory and diff against committed outputs (CI)
```

Overlays resolve their parents recursively — a named parent is looked up first among the other overlays being built (already-built starters), then as `starters/<name>.boject.json`, then as `starters/src/modules/<name>.boject.json`. Cycles and unknown parents are build-time errors. Every built output is validated with `validateBundle` before being written. `starters:check` ignores the `exportedAt` field when comparing.

Build outputs are committed so `pnpm content:import starters/sport.boject.json` works without a prior build step.

### Layout

```
starters/
  web-base.boject.json          # authored directly (the root starter; selectable)
  articles.boject.json          # built (extends web-base + taxonomy; selectable)
  sport.boject.json             # built (extends articles; selectable)
  rugby.boject.json             # built (extends sport; selectable)
  src/                          # build inputs — never imported directly
    overlays/
      articles.overlay.json
      sport.overlay.json
      rugby.overlay.json
    modules/
      taxonomy.boject.json      # authored directly (non-selectable module)
    partials/
      web-metadata.json         # field-partial
```

The rule: **top-level `*.boject.json` is the selectable starter set** (what `create-boject-cms` offers and what the tooling derives by reading this directory); **everything the build reads lives under `src/`**, in a subdirectory named for its kind. `web-base.boject.json` sits at the top because it's both the authored root and a final output — it has no overlay to build from.

### Overlay shape

```json
{
  "version": 1,
  "name": "articles",
  "extends": ["web-base", "taxonomy"],
  "contentTypes": [
    {
      "identifier": "Article",
      "mode": "create",
      "name": "Article",
      "description": null,
      "extends": ["web-metadata"],
      "fields": [
        /* BundleField[] */
      ]
    },
    {
      "identifier": "Link",
      "mode": "patch",
      "fields": [
        /* fields to add or replace */
      ]
    }
  ]
}
```

### Field-partial shape

```json
{
  "name": "web-metadata",
  "fields": [
    /* BundleField[], appended (with re-numbered `order`) after
       the content type's own fields when referenced via a
       content-type's `extends` array */
  ]
}
```
