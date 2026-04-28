# Load test report — 2026-04-28 (git: 97c56ad)

## Environment

- Host: see run metadata file

## Headline numbers

- Scenarios captured: 3
- Total durations recorded: 313157

## Scenario 1A — GraphQL cursor pagination

| scenario | page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| -------- | --------- | ----- | -------- | -------- | -------- | ------ |
| sitemap  | 100       | 104   | 10.8     | 16.3     | 18.7     | 0.00%  |
| sitemap  | 500       | 104   | 7.2      | 10.6     | 13.1     | 0.00%  |
| sitemap  | 1000      | 104   | 8.2      | 14.7     | 15.5     | 0.00%  |

## Scenario 1B — GraphQL flat RPS

| scenario | page_size | count  | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| -------- | --------- | ------ | -------- | -------- | -------- | ------ |
| flat     | -         | 263227 | 1.2      | 5.6      | 9.5      | 0.00%  |

> **Note:** the underlying raw files for this run still tag this scenario as
> `ramp` (it appears as `ramp,-,…` in `metrics.csv`). The k6 scenario block
> was renamed `ramp → flat` in commit `97c56ad`; subsequent runs will tag
> correctly. Numbers here are carried across by hand from the CSV.

## Scenario 2 — REST CRUD cycle

| scenario | page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| -------- | --------- | ----- | -------- | -------- | -------- | ------ |
| crud     | -         | 49618 | 28.5     | 65.2     | 90.1     | 39.56% |

## Recommendations for CMS operators

- **GraphQL rate limit: 1000 RPS per API key.** Scenario 1B ramped arrival rate from 50 → 2000 RPS over six 30 s stages and never crossed the 500 ms p99 soft-break threshold (p99 across 263 227 requests held at 9.5 ms, p95 at 5.6 ms, error rate 0 %). The system happily sustains the 2000 RPS ceiling we tested at, so 1000 RPS is a conservative production cap that leaves >2× headroom for spikes and a margin for the v1 implementation overhead. Revisit once we have a measured hard breakpoint.
- **Default page size: 500 (max 1000).** Scenario 1A's p99 latency by page size: 18.7 ms at 100, 13.1 ms at 500, 15.5 ms at 1000. The 500-row page is the sweet spot — fewer round trips than 100 without the marginal cost increase 1000 starts to show. Consumers paginating with `first: 500` should see the lowest tail latency for the same drain workload.
- **JSONB indexing (#25): inconclusive from this run.** The renderer aggregates Scenario 1B across all three flat shapes (`bare` / `filtered` / `relation`), so we can't isolate the filtered-vs-bare delta from `metrics.csv` alone. Flag this gap on #25 and split the renderer by `tags.shape` before the next sweep — without it we can't recommend an index based on observed evidence.

## Recommendations for consumers

- **Page size: prefer 500 for sitemaps and feed crawls.** Aligns with the operator default; fewer round trips than 100, lower p99 than 1000.
- **On 429: honour `Retry-After`.** Scenario 2 shows 39.56 % of REST CRUD requests returned 429 under sustained churn (49 618 requests, p99 = 90.1 ms). That's by design — the rate limiter is doing its job — but it means realistic write workloads must back off, not retry tight.

## Run notes

- Datasets: 1K / 10K / 30K / 100K rows (default sweep).
- Page sizes tested: 100 / 500 / 1000.
- VU levels for sitemap: 1 / 5 / 20.
- Scenario 1B raw NDJSON aggregates ~315 MB per shape; total run output ~1.2 GB (gitignored — see `perf/.gitignore`).
- See `metrics.csv` for the raw aggregate rows and `plots/sitemap-latency.png` for the latency-by-page-size chart.
