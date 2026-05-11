import 'dotenv/config';
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

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

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run seed in production: this script writes a default admin and a known test API key.'
    );
  }

  const email = process.env.INTEGRATION_TEST_USERNAME ?? 'admin@example.com';
  const password = process.env.INTEGRATION_TEST_PASSWORD ?? 'password';

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: await hashPasswordForSeed(password),
      firstName: 'Admin',
      lastName: 'User',
    },
  });

  const rawKey = 'boject_test_key_for_integration_tests_only';
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);
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
