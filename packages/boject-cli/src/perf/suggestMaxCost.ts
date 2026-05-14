/**
 * Suggested GraphQL complexity cap derived from a perf-flat run.
 *
 * Concept: under the CMS's default per-field weights, scenario 1B's
 * `bare` shape scores ~42 and `relation` shape scores ~162. If the
 * operator's hardware sustained the relation shape (low p99, no
 * errors), they can comfortably cap at ~6× the relation reference
 * cost — that's where the default DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
 * of 1000 comes from. If the hardware showed stress, the suggested
 * cap drops proportionally — but the renderer pairs the number with
 * a warning that lowering breaks clients.
 *
 * Returns null when there isn't enough signal (no graphql-flat stats
 * at all). When the relation shape is missing but bare is present,
 * falls back to the lighter reference cost.
 */

interface FlatStat {
  scenario: string;
  shape: string;
  p99: number;
  errorRate: number;
}

interface Options {
  currentMaxCost?: number;
}

interface Result {
  suggested: number;
  mode: 'green' | 'warn' | 'info';
}

// Representative cost class for a 100-item list with one RELATION
// traversal under the CMS's default per-field weights. Empirically
// validated against the Pothos plugin's algorithm in #122 task 5.
const RELATION_SHAPE_REFERENCE_COST = 162;
const BARE_SHAPE_REFERENCE_COST = 42;
const HEADROOM = 6;
const HEALTHY_P99_MS = 100;
const HEALTHY_ERROR_RATE = 0.01;
const MIN_SUGGESTED = 100;

function roundToNearest100(n: number): number {
  return Math.max(MIN_SUGGESTED, Math.round(n / 100) * 100);
}

export function suggestMaxCost(
  stats: FlatStat[],
  opts: Options
): Result | null {
  const flat = stats.filter((s) => s.scenario === 'flat');
  if (flat.length === 0) return null;

  const relation = flat.find((s) => s.shape === 'relation');
  const bare = flat.find((s) => s.shape === 'bare');
  const reference = relation ?? bare;
  if (!reference) return null;

  const referenceCost = relation
    ? RELATION_SHAPE_REFERENCE_COST
    : BARE_SHAPE_REFERENCE_COST;

  const healthy =
    reference.p99 <= HEALTHY_P99_MS &&
    reference.errorRate <= HEALTHY_ERROR_RATE;

  const suggestedRaw = healthy
    ? referenceCost * HEADROOM
    : referenceCost * (HEALTHY_P99_MS / Math.max(reference.p99, 1));

  const suggested = roundToNearest100(suggestedRaw);

  if (opts.currentMaxCost === undefined) {
    return { suggested, mode: 'info' };
  }
  if (suggested >= opts.currentMaxCost) {
    return { suggested, mode: 'green' };
  }
  return { suggested, mode: 'warn' };
}
