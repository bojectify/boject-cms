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

## Related

- `scripts/content-bundle/fixtures/` — test-only bundles used by unit tests in this module.
- `starters/` — production-ready bundles authored and committed for seeding new instances. See `starters/README.md`.
