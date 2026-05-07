// Ensures the perf DB has the admin user (used by rest-crud-cycle's session
// login) and the deterministic perf API key (used by every GraphQL scenario).
// Both are upserts so this is safe to run on every `pnpm perf:seed`.
//
// Without this, a fresh boject_perf DB has no users and no api keys, so the
// CMS rejects every scenario (401 invalid credentials / 401 invalid bearer)
// before any actual workload runs.
//
// KEEP IN SYNC with apps/cms/prisma/seed.ts — both files apply the same
// scrypt parameters and the same PERF_KEY_RAW value. A drift here silently
// 401s every scenario.
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import type { PrismaClient } from '../../apps/cms/generated/prisma/client';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const PERF_KEY_RAW = 'boject_perf_key_for_load_tests_only';

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
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const hashB64 = derived.toString('base64').replace(/=+$/, '');
  return `$scrypt$n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${saltB64}$${hashB64}`;
}

export interface BootstrapOptions {
  prisma: PrismaClient;
  adminEmail: string;
  adminPassword: string;
}

export async function ensurePerfDbBootstrap(
  opts: BootstrapOptions
): Promise<void> {
  // upsert with empty `update` leaves an existing user (and password hash)
  // untouched — only first run does the scrypt work.
  await opts.prisma.user.upsert({
    where: { email: opts.adminEmail },
    update: {},
    create: {
      email: opts.adminEmail,
      password: await hashPasswordForSeed(opts.adminPassword),
      firstName: 'Admin',
      lastName: 'User',
    },
  });

  // Scopes the perf key needs:
  // - content:read   → GraphQL queries (graphql-flat, graphql-sitemap)
  // - schema:read    → GET /api/schema/export (used by `boject perf seed`
  //                    when the bundle source is HTTP)
  const PERF_KEY_SCOPES = ['content:read', 'schema:read'];
  const keyHash = createHash('sha256').update(PERF_KEY_RAW).digest('hex');
  const keyPrefix = PERF_KEY_RAW.slice(0, 11);
  await opts.prisma.apiKey.upsert({
    where: { keyHash },
    update: { revokedAt: null, scopes: PERF_KEY_SCOPES },
    create: {
      name: '@boject/perf load test key',
      keyHash,
      keyPrefix,
      scopes: PERF_KEY_SCOPES,
    },
  });
}
