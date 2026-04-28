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

# Seed the perf API key (flag-gated; does not touch dev)
SEED_PERF_KEY=1 DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm prisma:seed

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

- `PERF_BASE_URL` — CMS URL. Default `http://localhost:4000`.
- `PERF_API_KEY` — Bearer token for GraphQL scenarios.
- `PERF_DATABASE_URL` — Prisma URL for seeding. Default `postgresql://boject:boject@localhost:5432/boject_perf`.
- `PERF_ADMIN_EMAIL` / `PERF_ADMIN_PASSWORD` — used by REST CRUD cycle session login. Defaults match the seed.
- `PERF_SIZES`, `PERF_PAGE_SIZES`, `PERF_VUS_LEVELS` — override sweep parameters (comma-separated positive numbers; bad input fails fast).
- `PERF_CRUD_N` — REST CRUD cycle size. Default 10000.
- `PERF_SAMPLER_CONTAINER` — docker container name for the pg sampler. Default `boject-cms-db-1` (matches `docker compose up -d` in this repo).
- `PERF_SAMPLER_INTERVAL_MS` — sample interval in milliseconds. Default 5000.
- `PERF_SAMPLER_OUT` — CSV output path for the sampler.

## Running against your own deployment

Operators running boject-cms in production can point this suite at their staging instance:

```bash
export PERF_BASE_URL=https://cms-staging.example.com
export PERF_API_KEY=<key-from-cms-ui>
export PERF_DATABASE_URL=postgresql://...@.../boject_staging
pnpm perf:sweep
```

The `PERF_DATABASE_URL` must point at a database you can safely truncate. Do **not** point the sweep at your production database — `reset.ts` refuses anything not ending in `/boject_perf`, but seeding assumes a disposable environment.

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
