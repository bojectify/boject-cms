/**
 * Resolve the URL of the postgres database used by the cms integration test
 * suite (the `boject_test` DB, reset+seeded by vitest.globalSetup.ts before
 * the suite runs).
 *
 * Override via `INTEGRATION_TEST_DATABASE_URL` for CI / remote postgres /
 * parallel runners with non-default ports. With the env var unset OR an
 * empty string, falls back to the local-dev URL so the existing developer
 * workflow is unchanged.
 *
 * Why `||` instead of `??`: docker-compose's passthrough syntax
 * `${INTEGRATION_TEST_DATABASE_URL:-}` sets the env var to an empty string
 * inside the container when the host has it unset (not to undefined). `??`
 * only catches null/undefined and would return the empty string, which
 * Prisma rejects as "Connection url is empty". `||` falls back on the
 * empty-string case too.
 *
 * Mirrors the env-var-with-fallback pattern used by
 * `apps/cms/server/test/credentials.ts`.
 */
import { resolveWorkerId, suffixDatabaseUrl } from './workerScope';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://boject:boject@localhost:5432/boject_test';

export function getTestDatabaseUrl(): string {
  const base =
    process.env.INTEGRATION_TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  return suffixDatabaseUrl(base, resolveWorkerId());
}
