import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
// Relative import: the generated Prisma client lives in apps/cms and is not
// a separate workspace export. The docker-entrypoint scripts use the same
// import strategy — see apps/cms/scripts/docker-entrypoint/seed-admin.ts.
import { PrismaClient } from '../../../../apps/cms/generated/prisma/client.js';
import { seedPerfArticleContentType } from './seedPerfArticleContentType.js';
import { getCliTestDatabaseUrl } from './dbUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const CMS_DIR = resolve(REPO_ROOT, 'apps/cms');

const TEST_DATABASE_URL = getCliTestDatabaseUrl();

const parsed = new URL(TEST_DATABASE_URL);
const PG_HOST = parsed.hostname;
const PG_PORT = parsed.port ? Number(parsed.port) : 5432;
const PG_USER = decodeURIComponent(parsed.username);
const PG_PASSWORD = decodeURIComponent(parsed.password);
const TEST_DB = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

export async function setup() {
  await ensureDatabaseExists();
  resetSchema();
  await seedContentType();
}

async function ensureDatabaseExists(): Promise<void> {
  // `prisma migrate reset` does NOT auto-create a missing database — it
  // expects the DB to exist and then drops/recreates the schema inside it.
  // Connect to the default `postgres` DB and CREATE the test DB if missing.
  const admin = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const r = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB]
    );
    if (r.rowCount === 0) {
      // Identifier interpolation is safe: TEST_DB comes from
      // CLI_INTEGRATION_TEST_DATABASE_URL (operator-controlled), not
      // request input. Postgres won't accept quoted identifiers with
      // backslashes; any embedded quote in the database name surfaces
      // as a parse error rather than an injection vector.
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
      console.log(`[integration:setup] Created database ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }
}

function resetSchema(): void {
  console.log(`[integration:setup] Resetting schema in ${TEST_DB}...`);
  execSync('pnpx prisma migrate reset --force', {
    cwd: CMS_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
        'Automated CLI integration test database reset',
    },
  });
}

async function seedContentType(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    await seedPerfArticleContentType(prisma);
    console.log(`[integration:setup] Seeded PerfArticle content type.`);
  } finally {
    await prisma.$disconnect();
  }
}

export const PERF_TEST_DATABASE_URL = TEST_DATABASE_URL;
