# Load Testing

## Overview

Build a reusable k6-based load-testing harness that answers the question "where are the performance limits of this CMS?" and produces a committed, human-readable report. Primary motivation: a downstream Next.js site calling `/api/graphql` at build time to generate a sitemap for 30K+ articles needs to know it won't exhaust the server or trip a rate limit — and today we have no evidence either way.

The harness is delivered in a new top-level `perf/` directory, runs locally against docker-compose, and emits timestamped reports committed to the repo. The initial report's numbers feed into a set of pre-filled follow-up tickets (GraphQL rate limiting, query complexity scoring, response-header feedback, CI regression guard).

Phase 1 (this ticket): harness + initial report + follow-ups opened. Phase 2 (separate ticket): wire into GitHub Actions as a regression guard.

## Approach

**k6 over Vegeta.** k6's native TypeScript, staged executors, and chained-scenario support are a better fit for the REST CRUD cycle (create → read → delete) than Vegeta's pre-generated-target model. Scripts live in-repo, get reviewed like any other code, and share nothing with the Nuxt app so there are no toolchain clashes.

**Top-level `perf/`, not `apps/cms/perf/`.** Matches the `starters/` precedent for shared-concern tooling. Keeps k6's Babel-based TS transpiler isolated from the Nuxt tsconfig. Reports don't show up in `pnpm dev` file watchers.

**Env-var-driven config.** `PERF_BASE_URL`, `PERF_API_KEY`, `PERF_DATABASE_URL` are read from the environment with sensible localhost defaults. An operator running boject in production can `git clone` the repo, install `perf/`, point it at their staging instance, and get their own curves — no extra work required from us. Documented as a supported path.

**Dedicated `boject_perf` database.** Hardcoded URL on the existing docker-compose Postgres, isolated from dev and test. The sweep truncates and reseeds per dataset size.

**Reports committed to git.** `perf/reports/YYYY-MM-DD-<run-id>/` directories capture the history over time. Full raw k6 output plus a rendered Markdown digest plus PNG plots. Small enough (<1MB per run without `raw.json`) that committing is fine; if `raw.json` grows past 10MB, move it to Git LFS or gitignore it and keep the CSV/plots.

## Repository Layout

```
perf/
├── README.md                         # How to run, interpret, extend
├── package.json                      # k6, tsx, chartjs-node-canvas (Prisma imported from apps/cms/generated/prisma, same pattern as docker-entrypoint scripts)
├── tsconfig.json
├── scenarios/
│   ├── graphql-sitemap.ts            # Scenario #1A
│   ├── graphql-flat.ts               # Scenario #1B
│   └── rest-crud-cycle.ts            # Scenario #2
├── lib/
│   ├── config.ts                     # env vars, defaults, thresholds
│   ├── auth.ts                       # API key / session login helpers
│   ├── metrics.ts                    # custom k6 metrics, tag helpers
│   └── pg-sampler.ts                 # polls pg_stat_* every 5s
├── seed/
│   ├── contentTypes.ts               # PerfArticle + PerfAuthor definitions
│   ├── bulk-insert.ts                # prisma.createMany seeder
│   ├── richtext-fixture.ts           # ~5KB ProseMirror JSON generator
│   └── reset.ts                      # truncate perf DB
├── scripts/
│   ├── sweep.ts                      # orchestrates the full multi-size run
│   ├── render-report.ts              # raw.json → summary.md + plots
│   └── open-followups.ts             # gh CLI helper to open tickets with numbers filled in
└── reports/
    └── 2026-04-21-<hash>/
        ├── summary.md
        ├── raw.json                  # NDJSON flattened; LFS or gitignored if >10MB
        ├── metrics.csv               # condensed; always committed
        └── plots/*.png               # <200KB each, committed
```

Top-level `pnpm` scripts, forwarded from root:

- `pnpm perf:seed --size=10000` — reset perf DB, bulk-insert N entries
- `pnpm perf:sweep` — full multi-size sweep, emit dated report dir
- `pnpm perf:scenario <name>` — run one scenario against currently-seeded DB
- `pnpm perf:report` — regenerate `summary.md` + plots from latest `raw.json`

## Seed Data

Two content types, version-controlled in `perf/seed/contentTypes.ts`:

- **PerfArticle** — ENTRY_TITLE (title), SLUG (slug), RICHTEXT (body, ~5KB), DATETIME (publishDate), TEXT (excerpt, ~200 chars), RELATION (author → PerfAuthor)
- **PerfAuthor** — ENTRY_TITLE (name), TEXT (bio, ~500 chars)

Realistic RICHTEXT payloads matter: response sizes drive network overhead, and trivial placeholders would under-report latency. `perf/seed/richtext-fixture.ts` generates deterministic ~5KB ProseMirror JSON from a small lorem-ipsum corpus — seeded random, same input produces same output, so runs are reproducible.

Seeding uses `prisma.createMany` directly against `ContentEntry` + `ContentEntryVersion` (the versioning envelope). Skips the REST API for speed — a 100K seed completes in under 15 seconds. The write path is exercised separately by scenario #2.

## Scenarios

### #1A — GraphQL cursor pagination (the sitemap case)

Sequential cursor walk simulating what Next.js `generateSitemaps()` does.

```
loop:
  query articleList(first: PAGE_SIZE, after: cursor) {
    edges { node { slug, updatedAt } }
    pageInfo { endCursor, hasNextPage }
  }
  if !hasNextPage: break
  cursor = endCursor
```

Parameters swept:

- `PAGE_SIZE`: 100, 500, 1000
- Dataset size: 1K, 10K, 30K, 100K (from outer sweep)
- Concurrency (VUs): 1, 5, 20

Metrics: wall-clock drain time, per-page p50/p95/p99, total request count, Postgres CPU + connection count (sampled by `pg-sampler.ts`), k6 `http_req_failed`.

Reported as: "draining a 30K article connection takes X seconds at `first: Y`; recommended page size is Z; at N concurrent builds, drain time degrades by M%".

### #1B — GraphQL flat RPS (synthetic ceiling)

k6 `constant-arrival-rate` executor hammering a single list query to find the request-rate ceiling.

```
for 60s at TARGET_RPS:
  articleList(first: 100, where: { publishDate: { gt: "2026-01-01" } })
```

Parameters:

- `TARGET_RPS`: 50, 100, 250, 500, 1000, 2000 (ramp until breakpoint)
- Dataset size: 30K (fixed — ceiling hunting doesn't need a sweep)
- Query shape: bare list, filtered list, list with relation resolution

Metrics: achieved RPS vs requested, p50/p95/p99 per step, first RPS at which p99 > 500ms (_soft break_), first RPS at which `http_req_failed > 1%` (_hard break_).

Reported as: "soft-breaks at X RPS, hard-breaks at Y RPS; adding a relation resolution drops the ceiling to Z RPS; recommended `/api/graphql` rate limit is N RPS per API key".

### #2 — REST CRUD cycle (the Vegeta replay)

Three sequential phases, each timed separately.

```
phase 1 — create:
  for i in 1..10000:
    POST /api/content-entries { contentTypeId, data: { entryTitle: `Perf ${i}`, ... } }

phase 2 — read:
  for id in created:
    GET /api/content-entries/:id

phase 3 — delete:
  for id in created:
    DELETE /api/content-entries/:id
```

Parameters:

- N = 10K (fixed; matches prior Vegeta baseline)
- 10 VUs concurrency (realistic editor team size; higher trivially trips the 50/60s mutation rate limit)
- Session auth — exercises the actual editor path, not the API-key surface

Metrics: per-phase wall-clock + RPS, per-phase p50/p95/p99, 429 count (confirms the rate limiter behaves), unique-field-validation overhead reported separately.

Reported as: "10K CRUD cycle completes in Xm Ys; create capped at N RPS by the mutation limit; per-request p99 is A/B/C ms; no errors outside intentional 429s".

## Sweep Orchestration

`pnpm perf:sweep` (`perf/scripts/sweep.ts`):

```
for size in [1000, 10000, 30000, 100000]:
  reset perf DB
  bulk-seed `size` PerfArticles + 50 PerfAuthors
  run scenario-1a (all page sizes × all concurrency levels)
  if size == 30000:
    run scenario-1b (one dataset size for ceiling hunting)
run scenario-2 once at the end (independent, creates+deletes its own data)
call render-report.ts → summary.md + plots from raw.json
```

Estimated full sweep runtime: ~25 minutes on a modern laptop (dominated by the 100K seed and the flat-RPS ramp). Individual scenarios runnable standalone via `pnpm perf:scenario <name>` for iteration.

## Metrics Collection

- **k6 built-ins** — `http_req_duration`, `http_req_failed`, `vus`, `iterations`. Captured via `--out json=raw.json`.
- **Custom k6 metrics** — per-phase trends for scenario #2, per-page trends for scenario #1A (k6 `Trend`), first-error-step for scenario #1B.
- **Postgres sampler** — `perf/lib/pg-sampler.ts` runs as a sidecar Node process during each scenario, polling `pg_stat_activity`, `pg_stat_database`, and container stats (`docker stats` JSON) every 5s. Writes to `reports/<run-id>/pg-samples.csv`. Good enough for v1; a proper `pg_stat_statements` integration can replace it later if we outgrow polling.

## Report Artifact

Each sweep emits `perf/reports/YYYY-MM-DD-<run-id>/`, where `<run-id>` is a short hash of `git rev-parse HEAD` + hostname to avoid local-vs-CI collisions. Four files:

**`summary.md`** — rendered from `raw.json` by `perf/scripts/render-report.ts`. Stable template so runs are comparable at a glance:

```
# Load test report — YYYY-MM-DD (git: <sha>)

## Environment
- Host: <os/arch/cores/mem>
- Postgres: <version + relevant settings>
- Node / Nuxt versions

## Headline numbers
- GraphQL sustained RPS ceiling
- 30K-article sitemap drain time
- 10K CRUD cycle total
- Postgres CPU ceiling

## Scenario 1A — GraphQL cursor pagination
[table: size × page-size × concurrency → wall-clock, p50, p95, p99]
[plot: drain time vs dataset size, one line per page-size]
[plot: p99 vs concurrency at 30K]

## Scenario 1B — GraphQL flat RPS
[table: target RPS → achieved, p50/p95/p99, error %, pg CPU]
[plot: p99 curve with soft/hard breakpoints marked]

## Scenario 2 — REST CRUD cycle
[per-phase table + timeline plot]

## Recommendations for CMS operators
- GraphQL rate limit suggested value
- Query complexity max suggested value
- Default page size for docs
- JSONB index candidates with evidence

## Recommendations for consumers
- Recommended `first:` value
- Expected drain time per N articles
- Retry-After guidance on 429
```

**`raw.json`** — full k6 output. Large (10–50MB per sweep). Git LFS if it routinely crosses 10MB; otherwise gitignored with only the derived `metrics.csv` retained.

**`metrics.csv`** — condensed one-row-per-(scenario, size, concurrency, page-size, metric). Diff-friendly in PRs; drives plot regeneration and future regression comparisons.

**`plots/*.png`** — rendered by `chartjs-node-canvas` (no browser needed). Committed. <200KB each.

## `perf/README.md` Contents

- What the harness tests and what it deliberately doesn't
- How to run the full sweep locally (prerequisites, commands, expected runtime)
- How to run a single scenario
- How to interpret the report (what p99, RPS, soft/hard break mean)
- How operators can run it against their own deployment (env vars)
- How to add a new scenario (file template, where to register, how plots pick it up)
- Link to the most recent report

A short "Performance" section in the top-level repo README links here. The operator-facing portions of the report itself are copied into a new `docs/performance/` directory so they're discoverable without digging into `perf/reports/`.

## Follow-up Tickets

DoD includes opening these with concrete numbers from the first report pre-filled:

1. **`Rate limiting on /api/graphql`** — reuses existing `rateLimitEndpoint` helper. Threshold from scenario 1B.
2. **`GraphQL query complexity scoring`** — Pothos has a community plugin; ticket specifies cost formula + max cost.
3. **`Rate-limit + cost headers on GraphQL responses`** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Query-Cost`. Also exposed via GraphQL `extensions`.
4. **`Richer 429 error shape`** — `{ error, retryAfter, suggestion }` across REST + GraphQL.
5. **`Phase 2: Wire perf suite into GHA with thresholds`** — constant-hardware regression guard. Depends on this ticket.
6. **`Portable perf scenarios via boject perf CLI`** — for `create-boject-cms` users. Depends on this ticket's scenario templates.
7. **Comment on #25 (`JSONB indexing`)** — not a new ticket; attach specific fields + breakpoints from this report to the existing issue so the indexing work has a concrete target.

`perf/scripts/open-followups.ts` drives this via the `gh` CLI after `render-report.ts` completes.

## Out of Scope (v1)

- CI integration / regression thresholds (phase 2, separate ticket)
- Image transform pipeline load testing
- Concurrent mixed editorial workload
- GraphQL `where`-filter stress beyond "with one filter vs. without"
- Multi-instance / replica deployment testing
- Any enforcement code (rate limits, complexity scoring, response headers)
- Portable scenarios for scaffolded projects (separate ticket, depends on this)

## Success Criteria

1. `pnpm perf:sweep` completes end-to-end on a clean checkout with `docker compose up -d`
2. A dated report directory is committed under `perf/reports/` with `summary.md`, `metrics.csv`, and `plots/` populated
3. `perf/README.md` documents the full flow including the operator self-test path
4. Six follow-up tickets opened on GitHub (items 1–6) with numbers from the report, plus a comment with observed evidence attached to existing issue #25
5. Operator-facing sections of the report copied into `docs/performance/`
6. A short "Performance" section in the top-level README linking to `perf/README.md`
