# Operator summary — 2026-04-28 (git: e869073)

> Operator-facing extract from
> [`perf/reports/2026-04-28-e869073/summary.md`](../../perf/reports/2026-04-28-e869073/summary.md).
> See the full report for the per-scenario tables, raw plot, and methodology
> notes.

## Environment

- Local dev — Nuxt + Postgres 17 in Docker on a developer workstation.
- Datasets: 1K / 10K / 30K / 100K rows.

## Headline numbers

- Scenarios captured: 3 (sitemap pagination, flat RPS ramp, REST CRUD churn).
- Total durations recorded: 314 195.
- Sitemap p99: 151 ms @ pageSize 100, 124 ms @ 500, 118 ms @ 1000 (larger
  pages → shorter tail).
- Flat ramp 50 → 2000 RPS, all three shapes:
  - `bare` p99 7.4 ms across 87 747 requests, 0 % errors.
  - `filtered` p99 8.1 ms across 87 749 requests, 0 % errors.
  - `relation` p99 7.8 ms across 87 748 requests, 0 % errors.
  - Soft-break threshold (500 ms p99) not hit.
- REST CRUD churn: 49 937 requests, p99 = 75.4 ms, 39.61 % 429 responses
  (rate limiter doing its job under sustained churn).

## Recommendations for CMS operators

- **GraphQL rate limit: 1000 RPS per API key.** The flat ramp held p99
  under 9 ms all the way to 2000 RPS across all three shapes; 1000 leaves
  > 2× headroom while we don't have a measured hard breakpoint.
- **Default page size: 500 (max 1000).** Best balance of tail latency
  (124 ms p99) and payload size; 1000 wins p99 by only ~5 % at double
  the payload.
- **JSONB indexing (#25): skip for now.** The `filtered` flat shape is
  only ~9 % slower than `bare` at p99 (8.1 ms vs 7.4 ms). That's well
  below the threshold that would justify a JSONB GIN index's write
  amplification — revisit if filtered becomes a hot path with a ≥3×
  delta.

## Recommendations for consumers

- **Page size: prefer 500 for sitemaps and feed crawls.** Aligns with the
  operator default; lower tail than 100, marginal cost over 1000.
- **On 429: honour `Retry-After`.** Realistic write workloads must back
  off, not retry tight.

## Run notes

- Page sizes tested: 100 / 500 / 1000.
- VU levels for sitemap: 1 / 5 / 20.
- CMS dev server bound to all interfaces (`NITRO_HOST=0.0.0.0`) so k6
  reaches it on IPv4 — see commit `e869073`.
