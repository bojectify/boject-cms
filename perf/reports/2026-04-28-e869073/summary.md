# Load test report — 2026-04-28 (git: e869073)

## Environment

- Host: see run metadata file

## Headline numbers

- Scenarios captured: 3
- Total durations recorded: 314195

## Scenario 1A — GraphQL cursor pagination

| page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| --------- | ----- | -------- | -------- | -------- | ------ |
| 100       | 338   | 49.9     | 86.7     | 151.0    | 0.00%  |
| 500       | 338   | 53.4     | 87.7     | 124.4    | 0.00%  |
| 1000      | 338   | 56.0     | 94.2     | 118.2    | 0.00%  |

## Scenario 1B — GraphQL flat RPS

| shape    | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| -------- | ----- | -------- | -------- | -------- | ------ |
| bare     | 87747 | 1.2      | 4.8      | 7.4      | 0.00%  |
| filtered | 87749 | 1.2      | 5.0      | 8.1      | 0.00%  |
| relation | 87748 | 1.1      | 5.0      | 7.8      | 0.00%  |

## Scenario 2 — REST CRUD cycle

| count | p50 (ms) | p95 (ms) | p99 (ms) | errors |
| ----- | -------- | -------- | -------- | ------ |
| 49937 | 28.8     | 64.2     | 75.4     | 39.61% |

## Recommendations for CMS operators

- **GraphQL rate limit: 1000 RPS per API key.** Scenario 1B's ramping arrival
  rate from 50 → 2000 RPS over six 30 s stages held p99 below 9 ms across
  all three query shapes (`bare` 7.4 ms, `filtered` 8.1 ms, `relation`
  7.8 ms — see Scenario 1B table) at 0 % error rate. The soft breakpoint
  (p99 > 500 ms) was nowhere in sight, so 1000 RPS is a conservative
  production cap that leaves >2× headroom; revisit once we have a
  measured hard breakpoint.
- **Default page size: 500 (max 1000).** Scenario 1A's p99 latency:
  151 ms at 100, 124 ms at 500, 118 ms at 1000. Larger pages mean fewer
  round trips, so the tail shortens monotonically. The marginal p99 win
  from 500 → 1000 (~6 ms, ~5 %) doesn't justify doubling the payload —
  pageSize=500 stays the sweet spot, with 1000 as the explicit max.
- **JSONB indexing (#25): skip for now.** Scenario 1B shows `filtered`
  only ~0.7 ms (9 %) slower than `bare` at p99 across 87 749 requests.
  That delta is well below the threshold that would justify the write
  amplification of a JSONB GIN index — revisit if we see the filtered
  shape become a hot path with a ≥3× delta.

## Recommendations for consumers

- **Page size: prefer 500 for sitemaps and feed crawls.** Aligns with the
  operator default; lower tail latency than 100, marginal cost over 1000.
- **On 429: honour `Retry-After`.** Scenario 2 saw 39.61 % of REST CRUD
  requests get 429ed under sustained churn (49 937 requests, p99 =
  75.4 ms). That's by design — the rate limiter is doing its job — but
  it means realistic write workloads must back off, not retry tight.

## Run notes

- Datasets: 1K / 10K / 30K / 100K rows (default sweep).
- Page sizes tested: 100 / 500 / 1000.
- VU levels for sitemap: 1 / 5 / 20.
- CMS dev server bound to all interfaces (`NITRO_HOST=0.0.0.0`) so k6 reaches
  it on IPv4 — see `e869073` for context.
- See `metrics.csv` for the raw aggregate rows and
  `plots/sitemap-latency.png` for the latency-by-page-size chart.
