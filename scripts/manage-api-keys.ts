import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const PREFIX = 'boject_';

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  const raw = PREFIX + randomBytes(32).toString('hex');
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 11);
  return { raw, hash, prefix };
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function create(name: string) {
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { name, keyHash: hash, keyPrefix: prefix },
  });

  console.log('API key created successfully.\n');
  console.log(`  Name:   ${name}`);
  console.log(`  Prefix: ${prefix}`);
  console.log(`  Key:    ${raw}`);
  console.log('\nSave this key now — it cannot be retrieved again after this.');
}

async function list() {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
  });

  if (keys.length === 0) {
    console.log('No API keys found.');
    return;
  }

  console.log(
    'Prefix'.padEnd(14) +
      'Name'.padEnd(24) +
      'Status'.padEnd(12) +
      'Last Used'.padEnd(24) +
      'Created'
  );
  console.log('-'.repeat(98));

  for (const key of keys) {
    const status = key.revokedAt ? 'REVOKED' : 'ACTIVE';
    const lastUsed = key.lastUsedAt
      ? key.lastUsedAt.toISOString().slice(0, 19)
      : 'Never';
    const created = key.createdAt.toISOString().slice(0, 19);
    console.log(
      key.keyPrefix.padEnd(14) +
        key.name.padEnd(24) +
        status.padEnd(12) +
        lastUsed.padEnd(24) +
        created
    );
  }
}

async function revoke(prefix: string) {
  const key = await prisma.apiKey.findFirst({
    where: { keyPrefix: prefix, revokedAt: null },
  });

  if (!key) {
    console.error(`No active API key found with prefix "${prefix}".`);
    process.exit(1);
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
  });

  console.log(`API key "${key.name}" (${prefix}) has been revoked.`);
}

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case 'create': {
      const name = args.join(' ');
      if (!name) {
        console.error('Usage: tsx scripts/manage-api-keys.ts create <name>');
        process.exit(1);
      }
      await create(name);
      break;
    }
    case 'list':
      await list();
      break;
    case 'revoke': {
      const prefix = args[0];
      if (!prefix) {
        console.error('Usage: tsx scripts/manage-api-keys.ts revoke <prefix>');
        process.exit(1);
      }
      await revoke(prefix);
      break;
    }
    default:
      console.error(
        'Usage: tsx scripts/manage-api-keys.ts <create|list|revoke>'
      );
      process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
