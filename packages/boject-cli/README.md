# @boject/cli

Maintenance and schema-as-code CLI for [boject-cms](https://github.com/bojectify/boject-cms) projects.

## Install

```bash
pnpm add -D @boject/cli
# or globally
pnpm add -g @boject/cli
```

The package ships a single `boject` binary.

## Configuration

Most commands read a committed `.boject.config.json` at the project root and an API key from the `BOJECT_API_KEY` env var.

```json
{
  "cms": { "url": "https://cms.dev.example.com" },
  "schema": { "path": "content-types/schema.boject.json" }
}
```

The CLI walks up from the current working directory to find the config — same pattern as Prettier / ESLint / Vitest. A developer running `boject schema pull` from a subdirectory still picks up the project root's config.

The API key is per-user / per-environment and lives in `.env` (gitignored). Mint one in the CMS:

```bash
# In the CMS repo
pnpm apikey:create my-cli --scopes schema:read,schema:write
```

Then put the printed `boject_...` key in your shell or project `.env`:

```bash
export BOJECT_API_KEY=boject_...
```

## Commands

### `boject upgrade`

Upgrade the CMS image tag in the current directory's `docker-compose.yml`, pull the new image, restart the container, and wait for the health endpoint.

```bash
boject upgrade                 # latest semver tag from the registry
boject upgrade --to 1.4.2      # specific version
boject upgrade --check         # exit 1 if an upgrade is available, 0 otherwise
boject upgrade --dry-run       # show the diff without applying
```

### `boject schema pull [--out <path>] [--url <url>]`

Fetches the live schema from the CMS and writes it to `content-types/schema.boject.json` (or `--out`). Always overwrites — review the diff with `git diff`.

```bash
boject schema pull
# ✓ Pulled schema from https://cms.dev.example.com
#   4 content types, 23 fields
#   Wrote /path/to/project/content-types/schema.boject.json (3247 bytes)
```

### `boject schema validate [<path>]`

Validates a bundle file's shape and runs the schema planner against an empty snapshot to surface cross-reference issues (e.g. a `RELATION` pointing at a content type that isn't declared in the same bundle). **No network — safe for pre-commit hooks.**

```bash
boject schema validate
# ✓ Bundle valid
#   4 content types, 23 fields, 0 cross-reference issues

boject schema validate ./content-types/schema.boject.json
# ✗ Bundle invalid
#   - field.type: Article.publishDate has invalid type "DATE"
#   - relation: Article.author targets unknown content type "Auther"
```

If `<path>` is omitted, falls back to the configured `schema.path`.

### `boject schema apply [<path>] [--allow-destructive] [--dry-run]`

Pushes the local bundle to the CMS via `POST /api/schema/apply`. The 99% workflow is "edit in dev, export, commit, deploy" — the entrypoint applier picks up the committed file on the next boot, so `apply` is the escape hatch for headless / one-off scenarios where redeploying is too heavyweight.

```bash
boject schema apply
# ✓ Applied
#   1 content type updated
#   2 fields created

boject schema apply --dry-run     # server runs the apply but rolls back the transaction
# ✓ Dry run
#   1 content type created
#   1 field created

boject schema apply --allow-destructive   # required to remove types/fields
```

**Output on rejection:**

- `BUNDLE_INVALID` → list of validator errors, exit 1.
- `SCHEMA_APPLY_BLOCKED` → list of blocker codes/paths/messages, exit 1.
- `SCHEMA_CHANGED_DURING_APPLY` → auto-retried once; exit 1 if the second attempt also races.

**Required scope:** `schema:write`.

### `boject schema check`

Pulls the live schema and diffs it against the on-disk bundle. Exits 0 if in sync, 1 if drift detected — designed for CI.

```bash
boject schema check
# ✓ Schema in sync with https://cms.dev.example.com

boject schema check
# ✗ Drift detected against https://cms.dev.example.com
#   - Article: field 'subtitle' exists locally but not on the server
#   - Article: field 'tagline' exists on the server but not locally
#   Run `boject schema pull` to update the local file.
```

CI pattern:

```yaml
- run: BOJECT_API_KEY=$BOJECT_API_KEY pnpm boject schema check
```

## API key scopes

CMS API keys carry one or more scopes:

| Scope          | Grants                                                  |
| -------------- | ------------------------------------------------------- |
| `content:read` | Read content via the GraphQL endpoint (`/api/graphql`). |
| `schema:read`  | Pull the schema bundle (`GET /api/schema/export`).      |
| `schema:write` | Push schema (`POST /api/schema/apply`).                 |

A key created with `--scopes schema:read` cannot read content via GraphQL. A key created with `--scopes content:read,schema:read` can do both. Issue narrow keys for narrow automation.

## Workflow

The intended development loop:

```bash
# 1. Edit content types in the CMS UI in development.

# 2. Pull the live schema into your project.
boject schema pull

# 3. Review the diff and commit.
git diff content-types/schema.boject.json
git commit -am "Add 'publishedOn' field to Article"

# 4. Deploy. The container's entrypoint runs the applier on boot —
#    no manual step required.
git push
```

CI ensures committed schema matches the dev CMS:

```bash
boject schema check
```

## Programmatic API

The four `runSchema*` functions are exported for embedding in scripts. They take a params object with `cwd`, `apiKey`, optional `flags`, and `stdout`/`stderr` callbacks; they return `{ exitCode: 0 | 1 }`.

```ts
import { runSchemaPull } from '@boject/cli';

const result = await runSchemaPull({
  cwd: process.cwd(),
  apiKey: process.env.BOJECT_API_KEY,
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
process.exit(result.exitCode);
```

## See also

- The CMS itself: [`boject-cms`](https://github.com/bojectify/boject-cms)
- Project scaffolder: [`create-boject-cms`](https://www.npmjs.com/package/create-boject-cms)
