import { execSync } from 'node:child_process';

/**
 * Reset the database to a clean seeded state before the test suite runs.
 * This ensures POST tests from previous runs don't leave stale data.
 */
export function setup() {
  console.log('[globalSetup] Resetting database...');
  execSync('pnpx prisma migrate reset --force', {
    stdio: 'inherit',
    env: {
      ...process.env,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
        'Automated test suite database reset',
    },
  });
  console.log('[globalSetup] Running seed...');
  execSync('pnpm prisma:seed', { stdio: 'inherit' });
  console.log('[globalSetup] Database reset and seeded.');
}
