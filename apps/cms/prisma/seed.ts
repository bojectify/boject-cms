import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { seedBaseline } from '../test/testDb';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run seed in production: this script writes a default admin and a known test API key.'
    );
  }

  // Admin user + deterministic test API key — shared with the per-file reset
  // (test/testDb.ts) so the globalSetup seed and the afterAll reset never drift.
  await seedBaseline(prisma);

  if (process.env.SEED_PERF_KEY === '1') {
    // KEEP IN SYNC with PERF_API_KEY_PLAINTEXT in perf/seed/api-key.ts —
    // a drift here silently 401s every k6 scenario.
    const PERF_KEY_RAW = 'boject_perf_key_for_load_tests_only';
    const keyHash = createHash('sha256').update(PERF_KEY_RAW).digest('hex');
    const keyPrefix = PERF_KEY_RAW.slice(0, 11);
    await prisma.apiKey.upsert({
      where: { keyHash },
      update: {
        revokedAt: null,
        scopes: ['content:read', 'content:write'],
      },
      create: {
        name: '@boject/perf load test key',
        keyHash,
        keyPrefix,
        scopes: ['content:read', 'content:write'],
      },
    });
    console.log('[seed] perf load-test API key present');
  }

  console.log('Seed complete (user + test API key).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
