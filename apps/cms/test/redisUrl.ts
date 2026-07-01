/**
 * Resolve the URL of the Redis logical DB used by the cms integration test
 * suite. Dev/prod use DB 0; tests use DB 1 (`redis://localhost:6379/1`) so a
 * `pnpm test` run never touches the dev cache — the same instance-isolation
 * pg (`boject_test`) and search (`entries_test`) already use.
 *
 * Override via `INTEGRATION_TEST_REDIS_URL` for CI / remote redis / parallel
 * runners. With the env var unset OR an empty string, falls back to the
 * local-dev DB-1 URL so the existing developer workflow is unchanged.
 *
 * Why `||` instead of `??`: docker-compose's passthrough syntax
 * `${INTEGRATION_TEST_REDIS_URL:-}` sets the env var to an empty string inside
 * the container when the host has it unset (not to undefined). `??` only
 * catches null/undefined and would return the empty string; `||` falls back on
 * the empty-string case too. Mirrors `test/dbUrl.ts`.
 */
import { resolveWorkerId, suffixRedisUrl } from './workerScope';

export const DEFAULT_TEST_REDIS_URL = 'redis://localhost:6379/1';

export function getTestRedisUrl(): string {
  const base = process.env.INTEGRATION_TEST_REDIS_URL || DEFAULT_TEST_REDIS_URL;
  return suffixRedisUrl(base, resolveWorkerId());
}
