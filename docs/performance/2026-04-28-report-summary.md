# Operator summary — 2026-04-28 (git: 97c56ad)

> Operator-facing extract from
> [`perf/reports/2026-04-28-5e65f2b/summary.md`](../../perf/reports/2026-04-28-5e65f2b/summary.md).
> See the full report for the per-scenario tables, raw plot, and methodology
> notes.

## Environment

- Local dev — Nuxt + Postgres 17 in Docker on a developer workstation.
- Datasets: 1K / 10K / 30K / 100K rows.

## Headline numbers

- Scenarios captured: 3 (sitemap pagination, flat RPS ramp, REST CRUD churn).
- Total durations recorded: 313 157.
- Sitemap p99: 18.7 ms @ pageSize 100, 13.1 ms @ 500, 15.5 ms @ 1000.
- Flat ramp 50 → 2000 RPS: p99 9.5 ms across 263 227 requests, 0 % errors —
  soft-break threshold (500 ms p99) not hit.
- REST CRUD churn: p99 90.1 ms; 39.56 % 429 responses (rate limiter doing its
  job under sustained churn).

## Recommendations for CMS operators

- **GraphQL rate limit: 1000 RPS per API key.** The flat ramp held p99 at
  9.5 ms all the way up to 2000 RPS; 1000 leaves >2× headroom for spikes
  while we still don't have a measured hard breakpoint.
- **Default page size: 500 (max 1000).** Best p99 of the three values
  tested in the sitemap drain (13.1 ms vs 18.7 / 15.5).
- **JSONB indexing (#25): inconclusive in this run.** The renderer
  aggregates flat shapes (`bare` / `filtered` / `relation`) into a single
  row, so the filtered-vs-bare delta isn't visible in `metrics.csv`. Track
  as a renderer follow-up before the next sweep.

## Recommendations for consumers

- **Page size: prefer 500 for sitemaps and feed crawls.** Aligns with the
  operator default; fewer round trips than 100, lower p99 than 1000.
- **On 429: honour `Retry-After`.** Realistic write workloads must back off,
  not retry tight.

## Run notes

- Page sizes tested: 100 / 500 / 1000.
- VU levels for sitemap: 1 / 5 / 20.
- Scenario 1B raw NDJSON aggregates ~315 MB per shape; total run output
  ~1.2 GB (gitignored — see `perf/.gitignore`).
- The raw files for this run still tag the flat scenario as `ramp` (k6
  stamps `options.scenarios.<key>` onto the `scenario` tag, overriding
  `options.tags`). Renamed in commit `97c56ad`; subsequent runs will tag
  correctly. The flat row in the report's summary was carried across by
  hand from `metrics.csv`.
