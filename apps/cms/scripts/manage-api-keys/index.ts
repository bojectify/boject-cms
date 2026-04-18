import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const PREFIX = 'boject_';

const HELP = `manage-api-keys — create, list, and revoke API keys

Usage:
  pnpm apikey:create <name>    Create a new API key (prints raw key once)
  pnpm apikey:list             List all API keys (prefix, name, status, last used)
  pnpm apikey:revoke <prefix>  Revoke an API key by its prefix

Flags:
  --help, -h   Show this help message

Notes:
  - Keys are SHA-256 hashed in the database; the raw key is only shown at
    create time. Store it somewhere safe — it cannot be recovered later.
  - Revocation is a soft delete (sets revokedAt). The row stays for audit.
  - Requires DATABASE_URL in the environment (loaded via .env).

Examples:
  pnpm apikey:create "Mobile app backend"
  pnpm apikey:list
  pnpm apikey:revoke boject_a1b
`;

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  const raw = PREFIX + randomBytes(32).toString('hex');
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 11);
  return { raw, hash, prefix };
}

function wantsHelp(values: string[]): boolean {
  return values.includes('--help') || values.includes('-h');
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
  if (!command || command === 'help' || wantsHelp([command ?? ''])) {
    console.log(HELP);
    process.exit(0);
  }
  if (wantsHelp(args)) {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case 'create': {
      const name = args.join(' ');
      if (!name) {
        console.error('Usage: pnpm apikey:create <name>');
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
        console.error('Usage: pnpm apikey:revoke <prefix>');
        process.exit(1);
      }
      await revoke(prefix);
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Run with --help to see usage.`
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
