# @boject/perf

Load-testing harness for boject-cms. Emits committed reports under `perf/reports/`.

## Prerequisites

- Docker + `docker compose up -d` (provides Postgres on :5432)
- `k6` installed locally — on macOS: `brew install k6`; Linux: follow https://k6.io/docs/getting-started/installation/
- `pnpm install` at the repo root

> **Native dependency note:** the report renderer pulls in `chartjs-node-canvas`, which depends on the `canvas` package and its native binary. `canvas` is on the workspace's `onlyBuiltDependencies` allow-list in `pnpm-workspace.yaml` so install rebuilds it. If you ever see `Cannot find module canvas.node`, run `pnpm rebuild canvas`.

## One-time setup

```bash
# Create the perf database (first time only; idempotent)
docker compose exec db psql -U boject -c "CREATE DATABASE boject_perf;" 2>/dev/null || true

# Apply the CMS schema to the perf database
DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm --filter cms prisma:migrate

# Seed the perf admin + load-test API key into the boject_perf DB
pnpm prisma:seed:perf

# Export the key for k6 to read (add to your .envrc or export each session)
export PERF_API_KEY=boject_perf_key_for_load_tests_only
```

## Running

The harness exercises the CMS over HTTP, so a Nuxt server has to be up
**and pointed at the perf database** (the seed writes there; if your
dev server is on the default `boject` DB it won't see PerfArticle and
the rest-crud-cycle scenario fails with `PerfArticle content type not
found`). Use the dedicated wrapper:

```bash
# Terminal 1 — CMS against the perf DB
pnpm perf:dev   # = DATABASE_URL=...boject_perf pnpm --filter cms dev

# Terminal 2 — load tests
pnpm perf:sweep
```

Other commands:

```bash
# One scenario against the currently-seeded DB
pnpm perf:scenario graphql-sitemap -- --env PERF_PAGE_SIZE=500 --env PERF_VUS=5

# Seed (resets the perf DB first by default; pass --no-reset to layer)
pnpm perf:seed --size=10000

# Re-render the latest report from raw.json (useful while iterating on templates)
pnpm perf:report

# Open follow-up tickets after reviewing a report
pnpm perf:followups perf/reports/2026-04-21-abc1234
```

## Configuration (env vars)

### Connection

- `PERF_BASE_URL` — CMS URL. Default `http://localhost:4000`.
- `PERF_API_KEY` — Bearer token for GraphQL scenarios.
- `PERF_DATABASE_URL` — Prisma URL for seeding. Default `postgresql://boject:boject@localhost:5432/boject_perf`.
- `PERF_ADMIN_EMAIL` / `PERF_ADMIN_PASSWORD` — used by REST CRUD cycle session login. Defaults match the seed.

### Scenario shape (read by `perf/scenarios/*.ts`)

- `PERF_LIST_FIELD` — root list query field name. Default `perfArticleList` (the internal `PerfArticle` fixture). Override when running against a different content type — the [`@boject/cli`](../packages/boject-cli/)'s `boject perf` flow sets this automatically from `--content-type`.
- `PERF_FILTER_FIELD` — DATETIME field for the `graphql-flat` `filtered` query shape. Default `publishDate`.
- `PERF_RELATION_FIELD` — single-target RELATION field for the `graphql-flat` `relation` query shape. Default `author`.
- `PERF_QUERY_SHAPE` — `graphql-flat` query shape: `bare` / `filtered` / `relation`. Default `bare`.
- `PERF_PAGE_SIZE` / `PERF_VUS` — `graphql-sitemap` page size and concurrent VUs. Default `100` / `1`.
- `PERF_TARGET_RPS` — `graphql-flat` peak RPS. Default `2000`. The default 6-stage ramp (`[50, 100, 250, 500, 1000, 2000]`) scales proportionally — passing 4000 produces `[100, 200, 500, 1000, 2000, 4000]`.
- `PERF_STAGES` — comma-separated RPS stage list, e.g. `50,100,500,2000`. Overrides the auto-scaled ramp wholesale.

### Sweep / sampler

- `PERF_SIZES`, `PERF_PAGE_SIZES`, `PERF_VUS_LEVELS` — override sweep parameters (comma-separated positive numbers; bad input fails fast).
- `PERF_CRUD_N` — REST CRUD cycle size. Default 10000.
- `PERF_SAMPLER_CONTAINER` — docker container name for the pg sampler. Default `boject-cms-db-1` (matches `docker compose up -d` in this repo).
- `PERF_SAMPLER_INTERVAL_MS` — sample interval in milliseconds. Default 5000.
- `PERF_SAMPLER_OUT` — CSV output path for the sampler.

## Running against your own deployment

Operators benchmarking their own deployment should use the [`@boject/cli`](../packages/boject-cli/)'s `boject perf` commands rather than `pnpm perf:*`. The CLI's scenarios are content-type-agnostic (driven by `PERF_LIST_FIELD` / `PERF_FILTER_FIELD` / `PERF_RELATION_FIELD`) and don't assume the internal `PerfArticle` fixture.

```bash
export BOJECT_API_KEY=<key-from-cms-ui>
boject perf check --url https://cms-staging.example.com --content-type Article
boject perf sweep --url https://cms-staging.example.com --content-type Article
```

The internal `pnpm perf:*` flow is for repo-internal benchmarking against `PerfArticle` / `PerfAuthor` and assumes a disposable `boject_perf` database — `reset.ts` refuses anything not ending in `/boject_perf`. Don't point it at production.

## Interpreting the report

- **p50 / p95 / p99** — response-time percentiles using nearest-rank (rank = `ceil(p × n)`). p50 is median; p99 is the slow-tail worst-common-case.
- **RPS** — requests per second sustained.
- **Soft breakpoint** — first load level at which p99 exceeds 500 ms.
- **Hard breakpoint** — first load level at which errors exceed 1%.

Operator-facing highlights from each report are mirrored into `docs/performance/`.

## Adding a scenario

1. Create `scenarios/<name>.ts`.
2. Import `k6/http`, `loadK6Config`, and any custom metrics from `lib/metrics-k6.ts`.
3. Export an `options` object with a named scenario and threshold(s).
4. Add a `default` function that performs the work.
5. Typecheck: `pnpm --filter @boject/perf typecheck:k6`.
6. Smoke-test: `pnpm perf:scenario <name>`.

## Known simplifications (v1)

- REST CRUD cycle phases are interleaved (iteration modulo 3), not strictly ordered. Rate-limit behaviour and per-phase latencies are still meaningful.
- Plots are limited to sitemap latency; extend `renderPlots()` in `scripts/render-report.ts` as new chart types are added.
- The `pg-sampler` only converts `MiB` from `docker stats` MemUsage; `KiB` / `GiB` fall back to `0`. Add unit conversion if your container starts emitting other units.
- Postgres sampler is a polling loop (5s interval) rather than `pg_stat_statements`.
