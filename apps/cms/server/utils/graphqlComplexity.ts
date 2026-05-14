/**
 * Default per-query complexity cap. Chosen from the 2026-04-28 perf
 * report scenario 1B: bare / filtered / relation shapes all sustained
 * p99 ≤ 9ms at 2000 RPS on the reference hardware. 1000 gives ~10×
 * headroom over the heaviest measured shape under the default weights
 * (relation, first:100 with the schema's defaultListMultiplier of 20 →
 * cost roughly 160). Operators recalibrate from their own hardware via
 * `boject perf` — see CLAUDE.md.
 *
 * Lowering this is a breaking change to the public GraphQL API;
 * raising via env var is safe, lowering needs consumer coordination.
 */
export const DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST = 1000;

/**
 * Resolve the configured GraphQL complexity cap. Defaults to
 * DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST when
 * BOJECT_GRAPHQL_COMPLEXITY_MAX_COST is unset, empty, or not a positive
 * finite number. Silent fallback so an operator typo can't crash the
 * server — mirrors the GRAPHQL_RATE_LIMIT_RPS / WEBHOOK_DNS_TIMEOUT_MS
 * pattern elsewhere in the codebase.
 */
export function getGraphqlComplexityMaxCost(): number {
  const raw = process.env.BOJECT_GRAPHQL_COMPLEXITY_MAX_COST;
  if (!raw) return DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST;
  }
  return parsed;
}

/**
 * Whether log-only / shadow mode is active. When true, over-cap
 * queries are computed and logged but still executed — the safe
 * rollout path when adopting or lowering the cap.
 */
export function isGraphqlComplexityLogOnly(): boolean {
  const raw = process.env.BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY;
  return raw === 'true' || raw === '1';
}
