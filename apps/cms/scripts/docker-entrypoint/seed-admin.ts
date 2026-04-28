import {
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { PASSWORD_RULES, validatePassword } from '../../utils/validatePassword';

export interface SeedAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  hashPassword: (password: string) => Promise<string>;
}

export interface SeedAdminResult {
  seeded: boolean;
  reason: 'created' | 'users-already-exist';
}

export async function seedAdminIfEmpty(
  prisma: Pick<PrismaClient, 'user'>,
  input: SeedAdminInput
): Promise<SeedAdminResult> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return { seeded: false, reason: 'users-already-exist' };
  }

  const hashed = await input.hashPassword(input.password);
  await prisma.user.create({
    data: {
      email: input.email,
      password: hashed,
      firstName: input.firstName,
      lastName: input.lastName,
    },
  });

  return { seeded: true, reason: 'created' };
}

// Inline scrypt hash compatible with nuxt-auth-utils' verifyPassword
// (which uses @adonisjs/hash Scrypt driver). Format: $scrypt$n=N,r=R,p=P$saltB64$hashB64
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

async function hashPasswordInline(password: string): Promise<string> {
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

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.env.BOJECT_ADMIN_EMAIL;
  const password = process.env.BOJECT_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      '[seed-admin] BOJECT_ADMIN_EMAIL and BOJECT_ADMIN_PASSWORD must be set'
    );
    process.exit(1);
  }

  const result = validatePassword(password, { email });
  if (!result.ok) {
    const messages = result.failures.map(
      (id) => PASSWORD_RULES.find((r) => r.id === id)!.label
    );
    console.error(
      `[seed-admin] BOJECT_ADMIN_PASSWORD does not meet requirements: ${messages.join('; ')}`
    );
    process.exit(1);
  }

  const firstName = process.env.BOJECT_ADMIN_FIRST_NAME ?? 'Admin';
  const lastName = process.env.BOJECT_ADMIN_LAST_NAME ?? 'User';

  const { PrismaClient } = await import('../../generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[seed-admin] DATABASE_URL must be set');
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await seedAdminIfEmpty(prisma, {
      email,
      password,
      firstName,
      lastName,
      hashPassword: hashPasswordInline,
    });
    console.log(
      `[seed-admin] ${result.seeded ? 'seeded admin user' : 'skipped — users already exist'}`
    );
  } catch (err) {
    console.error(
      `[seed-admin] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
