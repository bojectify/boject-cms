import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = resolve(HERE, 'migration.sql');

// Derive admin URL by swapping the last URL segment for "postgres".
const ADMIN_URL =
  process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, '/postgres$1') ??
  'postgresql://boject:boject@localhost:5432/postgres';

async function withFreshDb<T>(
  name: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const client = new Client({
    connectionString: ADMIN_URL.replace(/\/postgres(\?|$)/, `/${name}$1`),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
    const a2 = new Client({ connectionString: ADMIN_URL });
    await a2.connect();
    await a2.query(`DROP DATABASE IF EXISTS "${name}"`);
    await a2.end();
  }
}

async function setupPreMigrationSchema(client: Client) {
  await client.query(`
    CREATE TABLE "ContentEntry" (
      "id" TEXT PRIMARY KEY,
      "contentTypeId" TEXT NOT NULL,
      "entryTitle" TEXT NOT NULL,
      "slug" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
}

describe('20260513120000_add_entry_key', () => {
  let sql: string;
  beforeAll(async () => {
    sql = await readFile(MIGRATION_SQL, 'utf8');
  });

  it('backfills entryKey via slugify(entryTitle) when no collisions', async () => {
    await withFreshDb('boject_migration_test_clean', async (client) => {
      await setupPreMigrationSchema(client);
      await client.query(`
        INSERT INTO "ContentEntry" ("id", "contentTypeId", "entryTitle")
        VALUES
          ('e1', 'ct1', 'Hero Banner'),
          ('e2', 'ct1', 'About Us'),
          ('e3', 'ct2', 'Hero Banner');
      `);

      await client.query(sql);

      const { rows } = await client.query<{
        id: string;
        entryKey: string;
      }>(`SELECT "id", "entryKey" FROM "ContentEntry" ORDER BY "id"`);
      expect(rows).toEqual([
        { id: 'e1', entryKey: 'hero-banner' },
        { id: 'e2', entryKey: 'about-us' },
        { id: 'e3', entryKey: 'hero-banner' },
      ]);
    });
  });

  it('aborts when two titles in one contentType slugify identically', async () => {
    await withFreshDb('boject_migration_test_collision', async (client) => {
      await setupPreMigrationSchema(client);
      await client.query(`
        INSERT INTO "ContentEntry" ("id", "contentTypeId", "entryTitle")
        VALUES
          ('e1', 'ct1', 'Hero Banner'),
          ('e2', 'ct1', 'Hero - Banner'),
          ('e3', 'ct1', 'About');
      `);

      await expect(client.query(sql)).rejects.toThrow(
        /entryKey backfill produced duplicates/
      );
    });
  });
});
