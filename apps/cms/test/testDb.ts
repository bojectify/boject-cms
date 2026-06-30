/**
 * Test-database baseline + per-file reset (issue #406).
 *
 * The integration suite shares one `boject_test` database across all files.
 * `vitest.globalSetup.ts` resets + seeds it ONCE before the suite. Without a
 * per-file reset, a file that leaves data behind (a CHANGED entry, an extra
 * ContentType, webhook rows) pollutes every file that runs after it, making
 * the suite order-dependent (reorder / `.skip` / `.only` / `--filter` can fail
 * tests that pass in the default full run).
 *
 * `resetTestDb` restores the exact seeded baseline. `vitest.integrationSetup.ts`
 * runs it as a per-file `afterAll`, so every file leaves a clean slate. The
 * baseline (admin user + deterministic test API key) is shared with
 * `prisma/seed.ts` via `seedBaseline`, so the two never drift.
 *
 * Uses the relative `../generated/prisma/client` path (NOT the `#prisma` alias)
 * so it loads under both vitest and `tsx prisma/seed.ts`.
 */
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { getTestDatabaseUrl } from './dbUrl';

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Mirrors `hashPassword()` (server/utils) — kept standalone so this module
 *  runs outside Nitro (vitest + `tsx`). */
async function hashPasswordForSeed(password: string): Promise<string> {
  const n = 16384;
  const r = 8;
  const p = 1;
  const keyLength = 64;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, keyLength, {
    cost: n,
    blockSize: r,
    parallelization: p,
    maxmem: 32 * 1024 * 1024,
  });
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const hashB64 = derived.toString('base64').replace(/=+$/, '');
  return `$scrypt$n=${n},r=${r},p=${p}$${saltB64}$${hashB64}`;
}

/** The deterministic key every REST/GraphQL integration test authenticates with. */
const TEST_API_KEY_RAW = 'boject_test_key_for_integration_tests_only';

/**
 * Seed the universal test baseline: the admin user + the deterministic test
 * API key. Idempotent (upsert) and password-restoring (the `update` branch
 * resets the password + passwordVersion), so it's safe to call whether the
 * rows are absent (after a truncate / migrate reset) or present.
 *
 * Shared by `prisma/seed.ts` (the globalSetup seed) and `resetTestDb` below.
 */
export async function seedBaseline(prisma: PrismaClient): Promise<void> {
  const email = process.env.INTEGRATION_TEST_USERNAME ?? 'admin@example.com';
  const password = process.env.INTEGRATION_TEST_PASSWORD ?? 'password';
  const passwordHash = await hashPasswordForSeed(password);

  await prisma.user.upsert({
    where: { email },
    update: { password: passwordHash, passwordVersion: 0 },
    create: {
      email,
      password: passwordHash,
      firstName: 'Admin',
      lastName: 'User',
    },
  });

  const keyHash = createHash('sha256').update(TEST_API_KEY_RAW).digest('hex');
  const keyPrefix = TEST_API_KEY_RAW.slice(0, 11);
  await prisma.apiKey.upsert({
    where: { keyHash },
    update: { revokedAt: null, scopes: ['content:read', 'content:write'] },
    create: {
      name: 'Integration tests',
      keyHash,
      keyPrefix,
      scopes: ['content:read', 'content:write'],
    },
  });
}

// Order is irrelevant under CASCADE, but listing children before parents keeps
// the statement readable. RESTART IDENTITY is harmless (all PKs are UUIDs) and
// future-proofs against any serial column. `_prisma_migrations` is left intact.
const TRUNCATE_SQL =
  'TRUNCATE TABLE ' +
  [
    'WebhookDelivery',
    'Webhook',
    'ContentEntryVersion',
    'ContentEntry',
    'ContentTypeField',
    'ContentType',
    'ApiKey',
    'User',
  ]
    .map((t) => `"${t}"`)
    .join(', ') +
  ' RESTART IDENTITY CASCADE';

/**
 * Restore `boject_test` to the seeded baseline: truncate every data table
 * (preserving `_prisma_migrations`) and re-seed the admin + test API key. Run
 * as a per-file `afterAll` so each integration file leaves a clean slate.
 *
 * Note: Meilisearch (`entries_test`) and Redis (DB 1) are out of scope here —
 * search/cache tests clear their own index/keyspace per the existing harness
 * (`server/test/`). #406 addresses the Postgres-state leak.
 */
export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(TRUNCATE_SQL);
  await seedBaseline(prisma);
}

/** A standalone Prisma client pointed at the test DB, for the vitest setup
 *  file (which runs in the test process, separate from the booted Nuxt server). */
export function createTestPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
  return new PrismaClient({ adapter });
}
