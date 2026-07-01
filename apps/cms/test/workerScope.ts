/**
 * Per-worker test-resource scoping (#409).
 *
 * Each vitest worker gets its own Postgres DB / Meili index / Redis logical DB
 * so the integration project can run in parallel. These are the pure primitives:
 * a worker id from VITEST_POOL_ID and the three name/URL suffix functions. A
 * `null` id means "the base, un-suffixed resource" (main process / globalSetup /
 * any non-pooled context) — so the SAME code yields the template names inside
 * globalSetup and the worker names inside a worker.
 */
import os from 'node:os';

/** Redis has 16 logical DBs (0-15); DB 0 = dev, DB 1 = base test. Workers use
 *  `1 + id`, so the worker count must keep `1 + N <= 15`. */
const MAX_WORKERS_HARD_CAP = 14;
/** Memory-aware default for the shared ~16.8GB Docker Desktop VM (all compose
 *  services share it) — a handful of parallel Nuxt dev servers, not cores-2. */
const DEFAULT_WORKER_CAP = 4;

export function resolveWorkerId(): number | null {
  const raw = process.env.VITEST_POOL_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function resolveMaxTestWorkers(): number {
  const override = Number(process.env.TEST_MAX_WORKERS);
  const desired =
    Number.isInteger(override) && override > 0
      ? override
      : Math.min(os.cpus().length - 2, DEFAULT_WORKER_CAP);
  return Math.max(1, Math.min(desired, MAX_WORKERS_HARD_CAP));
}

export function suffixDatabaseUrl(baseUrl: string, id: number | null): string {
  if (id === null) return baseUrl;
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}_${id}`; // "/boject_test" -> "/boject_test_2"
  return url.toString();
}

export function suffixRedisUrl(baseUrl: string, id: number | null): string {
  if (id === null) return baseUrl;
  const url = new URL(baseUrl);
  url.pathname = `/${1 + id}`; // base test DB is 1; workers use 2..N+1
  return url.toString();
}

export function suffixMeiliIndex(baseName: string, id: number | null): string {
  return id === null ? baseName : `${baseName}_${id}`;
}

/** Stable Meili base — NEVER read from the config-mutated `process.env.MEILI_INDEX`
 *  (that would double-suffix on a reused worker). */
export const TEST_MEILI_INDEX_BASE =
  process.env.INTEGRATION_TEST_MEILI_INDEX || 'entries_test';

/** The worker-scoped test Meili index (base when not in a worker). */
export function resolveTestMeiliIndex(): string {
  return suffixMeiliIndex(TEST_MEILI_INDEX_BASE, resolveWorkerId());
}
