import type { Plugin } from 'graphql-yoga';
import { isAsyncIterable } from 'graphql-yoga';
import type { DocumentNode, ExecutionResult } from 'graphql';
import type { H3Event } from 'h3';
import { setResponseHeader } from 'h3';
import { GraphQLError } from 'graphql';
import { createComplexityRule } from '@pothos/plugin-complexity';

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

/**
 * Cost is computed at validate time but surfaced to the HTTP response /
 * GraphQL extensions at execute time. WeakMap keyed on DocumentNode
 * ferries the value between phases without leaking — entries are
 * garbage-collected when the parsed document goes out of scope.
 */
const costByDocument = new WeakMap<DocumentNode, number>();

/**
 * Test-only hook. Not part of the public API. Lets unit tests seed a
 * cost without going through the validation phase. WeakMap entries
 * are keyed on DocumentNode, so each test's freshly-parsed document
 * gets its own slot — no inter-test pollution to clean up.
 */
export const __test__ = {
  setCostForDocument(doc: DocumentNode, cost: number) {
    costByDocument.set(doc, cost);
  },
};

/**
 * Yoga plugin that adds a per-request validation rule computing the
 * operation's complexity. Over-cap queries either reject with a
 * `QUERY_TOO_COMPLEX` GraphQL error (default) or are logged and
 * permitted when `BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY=true`.
 *
 * Runs in the validate phase — after parse, before execution — so
 * rejected queries never touch resolvers.
 *
 * Note: variable values aren't available at validate time. Pothos's
 * complexity calculator falls back to argument literals (e.g.
 * `first: 100` in the query) and field default values; queries that
 * use variables (`first: $n`) compute against the field default. This
 * is the same tradeoff every static complexity analyzer makes — and
 * matches `maxDepthPlugin`'s contract.
 */
export const complexityYogaPlugin: Plugin = {
  onValidate({ params, addValidationRule }) {
    const cap = getGraphqlComplexityMaxCost();
    const logOnly = isGraphqlComplexityLogOnly();
    addValidationRule(
      createComplexityRule({
        context: {},
        variableValues: {},
        validate(result, reportError) {
          costByDocument.set(params.documentAST, result.complexity);
          if (result.complexity <= cap) return;
          if (logOnly) {
            console.warn(
              `[graphql-complexity] over-cap query permitted (log-only): score=${result.complexity}, cap=${cap}`
            );
            return;
          }
          reportError(
            new GraphQLError(
              `Query exceeds complexity cap (score: ${result.complexity}, cap: ${cap}). Reduce nesting, page size, or relation traversal.`,
              {
                extensions: {
                  code: 'QUERY_TOO_COMPLEX',
                  score: result.complexity,
                  cap,
                },
              }
            )
          );
        },
      })
    );
  },
  onExecute({ args }) {
    return {
      onExecuteDone({ result, setResult }) {
        if (!result || isAsyncIterable(result)) return;
        const cost = costByDocument.get(args.document);
        if (cost === undefined) return;
        const cap = getGraphqlComplexityMaxCost();
        const ctx = args.contextValue as { event?: H3Event };
        if (ctx.event) {
          setResponseHeader(ctx.event, 'X-Query-Cost', cost);
        }
        const exec = result as ExecutionResult;
        setResult({
          ...exec,
          extensions: {
            ...(exec.extensions ?? {}),
            queryCost: { cost, cap },
          },
        });
      },
    };
  },
};
