import { execSync } from 'node:child_process';

const TEST_DATABASE_URL =
  'postgresql://boject:boject@localhost:5432/boject_test';

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
  execSync('pnpx prisma migrate reset --force', { stdio: 'inherit', env });
  console.log('[globalSetup] Running seed...');
  execSync('pnpm prisma:seed', { stdio: 'inherit', env });
  console.log('[globalSetup] Test database ready.');
}
