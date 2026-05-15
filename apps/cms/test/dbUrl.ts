/**
 * Resolve the URL of the postgres database used by the cms integration test
 * suite (the `boject_test` DB, reset+seeded by vitest.globalSetup.ts before
 * the suite runs).
 *
 * Override via `INTEGRATION_TEST_DATABASE_URL` for CI / remote postgres /
 * parallel runners with non-default ports. With the env var unset, falls
 * back to the local-dev URL so the existing developer workflow is unchanged.
 *
 * Mirrors the env-var-with-fallback pattern used by
 * `apps/cms/server/test/credentials.ts`.
 */
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://boject:boject@localhost:5432/boject_test';

export function getTestDatabaseUrl(): string {
  return process.env.INTEGRATION_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}
