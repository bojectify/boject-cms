/**
 * Resolve the URL of the postgres database used by the @boject/cli
 * integration test suite (the `boject_perf_test` DB, reset+seeded by
 * tests/integration/globalSetup.ts before the suite runs).
 *
 * Override via `CLI_INTEGRATION_TEST_DATABASE_URL` for CI / remote postgres
 * / parallel runners with non-default ports. With the env var unset, falls
 * back to the local-dev URL so the existing developer workflow is unchanged.
 *
 * Kept separate from the cms-side helper (apps/cms/test/dbUrl.ts) because
 * the two suites target different databases (boject_test vs boject_perf_test)
 * and CI may want to point each at independently-provisioned postgres
 * instances.
 */
export const DEFAULT_CLI_TEST_DATABASE_URL =
  'postgresql://boject:boject@localhost:5432/boject_perf_test';

export function getCliTestDatabaseUrl(): string {
  return (
    process.env.CLI_INTEGRATION_TEST_DATABASE_URL ??
    DEFAULT_CLI_TEST_DATABASE_URL
  );
}
