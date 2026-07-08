# @boject/cli

[![npm](https://img.shields.io/npm/v/@boject/cli)](https://www.npmjs.com/package/@boject/cli)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)

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

### `boject perf <command>`

Operator-facing load-test runner. Spawns [k6](https://k6.io/) against your CMS, emits a markdown + JSON report. Run read-only against an existing dataset, or seed first via SQL — see the subcommands below.

**Prerequisites:** [k6](https://k6.io/docs/get-started/installation/) on PATH (`brew install k6` on macOS). The CLI fails fast with an install hint if it isn't.

**Required scope:** `content:read`.

> **Local smoke tests:** when running against `http://localhost:...`, lower the rate with `--target-rps 200` (or similar). The default 50→2000 RPS ramp opens enough TCP connections to exhaust your OS's ephemeral port pool partway through (~30k ports on macOS, with `TIME_WAIT` holding sockets for 60–120s after close). You'll see `dial tcp: connect: can't assign requested address` once the pool runs dry. The default ramp is calibrated for perf-clones behind a load balancer, not single-machine localhost runs. The `boject perf sweep` defaults are equally heavy — same advice applies.

`.boject.config.json` may include an optional `perf` section to cache the common flags:

```json
{
  "cms": { "url": "https://cms-staging.example.com" },
  "schema": { "path": "content-types/schema.boject.json" },
  "perf": {
    "contentType": "Article",
    "filterField": "publishDate",
    "relationField": "author",
    "out": "./perf-reports"
  }
}
```

#### `boject perf check --content-type <id> [flags]`

Preflight: verifies k6 is on PATH, the target is reachable, the API key works, the content type exists, and a DATETIME / single-target RELATION field can be selected for the `filtered` / `relation` query shapes. Doesn't run any load.

```bash
boject perf check --content-type Article
# Preflight OK ✓
#   list field:     articleList
#   filter field:   publishDate
#   relation field: author
```

Exits 0 on success, 2 on environment problems (k6 missing, target unreachable, key invalid), 3 on input problems (missing flag).

#### `boject perf scenario <name> --content-type <id> [flags]`

Run one scenario. `<name>` is `graphql-flat` or `graphql-sitemap`.

- **`graphql-flat`** — RPS ramp 50→2000 over 3 minutes against three query shapes (`bare` / `filtered` / `relation`). Heavy load — fires a TTY confirm prompt before starting; bypass with `--yes` for CI.
- **`graphql-sitemap`** — Cursor-paginated drain of the content type. Lighter; no confirm prompt.

```bash
boject perf scenario graphql-sitemap --content-type Article
# [k6] running (10.4s), 100/100 VUs, 1 complete and 0 interrupted iterations
# Report written to perf-reports/2026-05-06T14-32-11Z-a3f9
```

Power-user overrides for `graphql-flat`:

- `--target-rps <n>` — peak RPS. Default 2000. The 6-stage ramp scales proportionally.
- `--stages <csv>` — explicit RPS stages, e.g. `50,100,500,2000`. Overrides the scaled ramp wholesale.

Field overrides (introspection picks defaults):

- `--filter-field <id>` — DATETIME field for the `filtered` shape. Skipped if absent.
- `--relation-field <id>` — single-target RELATION field for the `relation` shape. Skipped if absent.

#### `boject perf seed --content-type <id> [flags]`

> ⚠ **Destructive — throwaway DBs only.**
> `boject perf reset` and `boject perf seed --reset` issue an unconditional `TRUNCATE` against the target DB's `ContentEntry` and `ContentEntryVersion` tables. **Every entry is wiped, not just the ones this CLI created.** Only run against a disposable `_perf` or `_staging` clone you can rebuild. The `--allow-database <name>` escape hatch exists for non-conforming clone names; never reach for it to point at a production or dev database.

Generates and writes deterministic seed entries for a content type. Uses `--database-url <perf>` — raw `pg` writes. Refuses any database whose name doesn't end in `_perf` / `_staging` unless `--allow-database` lists it. Pair with `--reset` for a clean target.

Use `--size <n>` to control the entry count and `--seed <n>` (default `1`) to pick the deterministic data set.

##### Conflict handling on re-run

If the target DB already contains entries with titles or slugs that match what the seed step would generate (this happens when re-running with the default `--seed 1` against a populated DB), the seed step skips conflicting rows and continues. The final progress line surfaces how many were skipped:

```
[perf:seed] inserted 950 / total 1000 (50 skipped) entries
```

If the skip rate exceeds 50%, the seed step aborts with a `SeedMostlyDuplicateError` — this catches the case where the target DB is mostly already populated and the new run would do nothing useful. Two ways to unblock:

- **Pass `--seed <n>`** for a different deterministic data set.
- **Reset the target DB first:** `boject perf reset --database-url <url> --yes`.

**Cascade skips for cross-references.** When an entry is skipped (either via 409 conflict or because a previous entry it references was skipped), the skip propagates: any entry whose data points at the skipped entry's synthetic ID is also skipped. This prevents 400 errors from the CMS validating broken RELATION/MULTIRELATION/RICHTEXT references.

The threshold check (50%) accounts for both kinds of skip. A repeat seed against a populated DB with multi-group bundles (e.g. Author + Article) trips the threshold cleanly: authors collide, articles cascade-skip, everything is loudly reported, the operator passes `--seed <n>` or resets.

Cascade-skipped entries are filtered BEFORE the envelope `INSERT` — no orphan `ContentEntry` rows are created.

For SQL bundles with deferred-edge patches: if a patch's target or `fieldUpdates` reference a skipped entry, the patch is suppressed with an `stderr` log (`[perf:seed] skipping patch — ...`). Patch skips do NOT count toward the entry-level threshold — they're an internal mechanism for cross-group circular refs, not an operator-visible metric.

#### `boject perf scenario rest-crud-cycle --content-type <id> [flags]`

Write-load scenario: 10 VUs run interleaved CREATE / READ / DELETE iterations against `/api/entries`. Requires `--database-url <perf>`. Refuses `--read-only`. Use `--crud-n <n>` to control iterations per phase (default 10000, matches the canonical sweep).

```bash
boject perf scenario rest-crud-cycle --content-type Article \
  --database-url postgresql://boject:boject@localhost:5432/boject_perf \
  --crud-n 50 --yes
```

The report's `## Scenario 2 — REST CRUD cycle` section breaks down latency by phase (`create` / `read` / `list` / `delete`).

`rest-crud-cycle` does not run a seed step — the scenario's CREATE phase produces its own entries. Pass `--reset` if you want a clean DB before the run.

**Required scope:** `content:write`.

#### `boject perf sweep --content-type <id> [flags]`

Run both scenarios across a matrix. `graphql-sitemap` iterates `pageSizes × vusList`; `graphql-flat` runs all three query shapes once. Single combined report at the end.

```bash
boject perf sweep --content-type Article --yes
# ... 12 k6 runs ...
# Sweep report written to perf-reports/2026-05-06T14-35-22Z-b1cd
```

Matrix overrides:

- `--page-sizes <csv>` — default `100,500,1000`.
- `--vus <csv>` — default `1,5,20`.

Plus all the `boject perf scenario` flags (target RPS, stages, field overrides, etc.).

#### `boject perf report [--from <dir>] [--out <dir>]`

Re-render `summary.md`, `metadata.json`, and `metrics.csv` from an existing run. Useful when iterating on the renderer or after a partial run.

```bash
boject perf report                  # re-render the latest run in ./perf-reports
boject perf report --from <dir>     # re-render a specific run dir
```

#### Output files

Every run writes to `<out>/<timestamp>/`:

- `summary.md` — human-readable report (banners, scenario tables, run notes)
- `metadata.json` — machine-readable run context: target host, content type, fields used, intensity (RPS / stages), scenarios + outcomes, partial flag, schemaVersion. Consumed by downstream tooling. **API keys are never written.**
- `metrics.csv` — one row per `(scenario, page_size, shape)` with count, p50, p95, p99, error rate as a fraction.

  **CSV column convention for `rest-crud-cycle`:** when the scenario is `rest-crud-cycle`, the `shape` column carries the phase value (`create` / `read` / `list` / `delete`) and the `page_size` column is `-`. This preserves the existing CSV schema without a `schemaVersion` bump — consumers parsing crud rows should know to read `shape` as the phase dimension.

- `raw.json` — k6 NDJSON output, one point per line.
- `k6-stderr.log` — sanitised stderr from k6 (no API keys).
- `pg-samples.csv` — **seed-direct only.** When `--database-url` is set, `boject perf scenario` / `sweep` runs a `pg_stat_activity` sampler alongside k6 (5s interval by default; override via `PERF_SAMPLER_INTERVAL_MS`). Peak and mean connection-pool counts are rendered into `summary.md` as a `Database connection pool` table. Operators using `--read-only` get no panel — there's no DB access in that mode.

#### Sanitisation

API keys are never logged to stdout/stderr or written to any output file. URLs with embedded credentials (`https://user:pass@host`) are stripped before logging. The k6 stderr log file is sanitised text (not a byte mirror) — defence in depth in case k6 ever echoes a Bearer header.

## API key scopes

CMS API keys carry one or more scopes:

| Scope            | Grants                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `content:read`   | Read content via the GraphQL endpoint (`/api/graphql`). Required for `boject perf`.           |
| `content:write`  | Create, update, delete, and transition content entries (`/api/entries`).                      |
| `content:export` | Export content entries as a portable bundle (`GET /api/content-bundle/export`), incl. drafts. |
| `content:import` | Import content entry bundles (`POST /api/content-bundle/import`).                             |
| `schema:read`    | Pull the schema bundle (`GET /api/schema/export`).                                            |
| `schema:write`   | Push schema (`POST /api/schema/apply`).                                                       |
| `apikey:read`    | List API keys.                                                                                |
| `apikey:write`   | Create and revoke API keys.                                                                   |

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

## Testing

Three Vitest projects, run via `pnpm test` (all) or individually:

- `pnpm test:unit` — hermetic unit tests. No external dependencies.
- `pnpm test:e2e` — end-to-end tests that build the CLI via `tsup` and exercise the built `dist/` binary. No DB.
- `pnpm test:integration` — exercises the SQL writer against a real Postgres. Requires `docker compose up -d` (or any Postgres on `localhost:5432` with the `boject` / `boject` user). Owns its own `boject_perf_test` database — created automatically on first run, schema-reset between suite runs. Does not touch `boject` (dev) or `boject_test` (cms integration).

## See also

- The CMS itself: [`boject-cms`](https://github.com/bojectify/boject-cms)
- Project scaffolder: [`create-boject-cms`](https://www.npmjs.com/package/create-boject-cms)

## License

Source-available under the [Business Source License 1.1](./LICENSE); each published version converts to Apache-2.0 four years after its release. See the [repository README](https://github.com/bojectify/boject-cms#license) for the plain-language summary.
