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

```bash
pnpm content:import ./starters/base.boject.json
```

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
