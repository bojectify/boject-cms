# content-bundle

CLI for exporting, importing, and validating dynamic content (types and/or entries) as portable JSON bundles.

Run `pnpm content:export --help` (or any other subcommand with `--help` / `-h`) for inline usage.

## Commands

| Command                                      | Script                                     | Description                                                 |
| -------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `pnpm content:export [flags]`                | `scripts/content-bundle/index.ts export`   | Export content types and/or entries to a JSON bundle.       |
| `pnpm content:import <path> [flags]`         | `scripts/content-bundle/index.ts import`   | Import a JSON bundle into the CMS.                          |
| `pnpm content:validate <path>`               | `scripts/content-bundle/index.ts validate` | Validate a bundle's shape without touching the DB.          |
| `tsx scripts/content-bundle/index.ts --help` | —                                          | Print usage (also available as `-h` or the `help` command). |

## Flags

| Flag           | Applies to         | Description                                                                    |
| -------------- | ------------------ | ------------------------------------------------------------------------------ |
| `--schema`     | `export`, `import` | Only content types. Default for `export`.                                      |
| `--entries`    | `export`, `import` | Only entries.                                                                  |
| `--all`        | `export`, `import` | Both content types and entries.                                                |
| `--portable`   | `export`           | Rewrite UUID references to `identifier` / `slug` keys for cross-instance use.  |
| `--out <path>` | `export`           | Write output to a custom path. Defaults to `./generated/content-bundle*.json`. |
| `--author <s>` | `import`           | Attribute imported entries to this user identifier.                            |
| `--help`, `-h` | all                | Print usage.                                                                   |

## Output location

Exports default to `./generated/content-bundle-<mode>.json` (or `./generated/content-bundle.json` for `--all`). The `generated/` directory is gitignored for these outputs, so bundles won't be accidentally committed. Override with `--out <path>` when you want a specific location (e.g. when authoring a starter under `starters/`).

## Examples

```bash
# Export schema only (default), portable, to ./generated/content-bundle-schema.json
pnpm content:export --portable

# Export everything to a custom path
pnpm content:export --all --out ./tmp/full-dump.json

# Import a bundle, auto-detecting mode from its shape
pnpm content:import ./starters/base.boject.json

# Import entries only and attribute them to an author
pnpm content:import ./generated/content-bundle-entries.json --entries --author admin

# Validate a bundle without touching the database
pnpm content:validate ./starters/sport.boject.json
```

## Image bytes (sidecar layout)

`content:export --out ./my-bundle/` (a **directory** target) writes:

    my-bundle/
    ├── bundle.json
    └── assets/
        └── <storageKey>      # original image bytes

Import the directory with `content:import ./my-bundle/` to restore entries
**and** image bytes. A single-file `.json` target (or no `--out`) writes
references only — image bytes are not bundled (status quo).

- `--no-assets` — references-only even with a directory target (use when source
  and target share one storage bucket, so the storageKey already resolves).
- `--max-asset-size <MB>` / `--max-bundle-size <MB>` — size caps (default
  25 MB / 1 GB). Export fails fast if either is exceeded, or if a referenced
  storageKey has no bytes in storage.
- Import is idempotent: bytes already present in the target are skipped.
- `content:validate <dir>` also checks every referenced image storageKey has a
  file in `assets/` (offline; only for bundles that carry contentTypes).
- Originals only — transforms regenerate on demand.

## Tarball wire format

A `.tar.gz` / `.tgz` `--out` target packs the **same sidecar layout** into one
gzipped tar — a single portable file:

    bundle.tar.gz   (gzip → tar)
    ├── bundle.json
    └── assets/
        └── <storageKey>

```bash
# Export everything as one archive (bundle.json + image bytes inside)
pnpm content:export --all --out ./my-bundle.tar.gz

# Import it — auto-detected by extension or gzip magic bytes; restores bytes
pnpm content:import ./my-bundle.tar.gz

# Validate an archive offline (shape + asset completeness)
pnpm content:validate ./my-bundle.tar.gz
```

- The archive is byte-for-byte the sidecar directory, just compressed — same
  caps (`--max-asset-size` / `--max-bundle-size`), same completeness checks.
- `--no-assets` with a `.tar.gz` target packs only `bundle.json`.
- Import / validate auto-detect a tarball by the `.tar.gz` / `.tgz` extension or
  the gzip magic bytes (so a renamed archive still works).
- Local-CLI only: the tarball is a file you move yourself. The remote
  `/api/content-bundle/*` endpoints stay references-only (no byte transfer).

## Related

- `scripts/content-bundle/fixtures/` — test-only bundles used by unit tests in this module.
- `starters/` — production-ready bundles authored and committed for seeding new instances. See `starters/README.md`.
