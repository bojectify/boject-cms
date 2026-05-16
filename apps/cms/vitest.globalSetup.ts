import { execSync } from 'node:child_process';
import { getTestDatabaseUrl } from './test/dbUrl';

const TEST_DATABASE_URL = getTestDatabaseUrl();

/**
 * Reset the test database to a clean seeded state before the suite runs.
 * Uses a separate "boject_test" database so dev data in "boject" is untouched.
 */
export function setup() {
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
      'Automated test suite database reset',
  };

  console.log('[globalSetup] Resetting test database (boject_test)...');
  // `pnpm exec` runs the locally-installed prisma (the version Prisma
  // generated the client from). `pnpx` / `pnpm dlx` would download a fresh
  // copy from the registry instead, hit the `allowBuilds` interactive
  // prompt on a clean pnpm store, and risk version drift between the
  // migrator and the generated client.
  execSync('pnpm exec prisma migrate reset --force', {
    stdio: 'inherit',
    env,
  });
  console.log('[globalSetup] Running seed...');
  execSync('pnpm prisma:seed', { stdio: 'inherit', env });
  console.log('[globalSetup] Test database ready.');
}
