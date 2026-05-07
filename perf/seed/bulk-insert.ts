import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { generatePerfData, writeViaSql } from '@boject/cli/perf';
import { PERF_BUNDLE } from './perf-bundle.fixture';
import { loadNodeConfig } from '../lib/config-node';
import { resetPerfDb } from './reset';
import { ensurePerfDbBootstrap } from './bootstrap';

export interface SeedExecOptions {
  client: Client;
  articleCount: number;
  seed?: number;
}

/**
 * Workspace seeder for `pnpm perf:sweep`. Wraps the canonical generator
 * + SQL writer in @boject/cli, pre-filling the bundle with the workspace's
 * historical PerfArticle/PerfAuthor shape.
 *
 * Caller responsibility: ensure content types exist in the perf DB
 * (the legacy seedPerfData did this via prisma upsert; the new flow
 * relies on `boject schema apply` or equivalent having been run first).
 */
export async function seedPerfData(
  opts: SeedExecOptions
): Promise<{ inserted: number }> {
  // Step 1: ensure content types exist (Prisma upsert; the writer expects them)
  const { PrismaClient } =
    await import('../../apps/cms/generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const cfg = loadNodeConfig();
  const adapter = new PrismaPg({ connectionString: cfg.perfDatabaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    for (const ct of PERF_BUNDLE.contentTypes!) {
      await prisma.contentType.upsert({
        where: { identifier: ct.identifier },
        update: {},
        create: {
          id: ct.id!,
          identifier: ct.identifier,
          name: ct.name,
          description: ct.description ?? undefined,
          fields: {
            create: ct.fields.map((f) => ({
              id: f.id ?? undefined,
              identifier: f.identifier,
              name: f.name,
              type: f.type,
              required: f.required,
              unique: f.unique ?? false,
              order: f.order,
              options: (f.options ?? undefined) as object | undefined,
            })),
          },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  // Step 2: generate + write via the canonical CLI module
  const generated = generatePerfData(PERF_BUNDLE, {
    contentTypeIdentifier: 'PerfArticle',
    count: opts.articleCount,
    seed: opts.seed ?? 1,
  });
  return writeViaSql(opts.client, generated, { batchSize: 500 });
}

// CLI entry — pathToFileURL handles symlinks, spaces, and platform separators.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      size: { type: 'string', default: '10000' },
      'no-reset': { type: 'boolean', default: false },
    },
  });
  const articleCount = Number(values.size);
  if (!Number.isFinite(articleCount) || articleCount < 1) {
    console.error(`Invalid --size: ${values.size}`);
    process.exit(1);
  }

  const cfg = loadNodeConfig();
  const pg = new Client({ connectionString: cfg.perfDatabaseUrl });
  await pg.connect();

  try {
    if (!values['no-reset']) {
      await resetPerfDb({
        databaseUrl: cfg.perfDatabaseUrl,
        runQuery: async (sql: string) => {
          await pg.query(sql);
        },
      });
      console.log(`[perf:seed] reset ${cfg.perfDatabaseUrl}`);
    }

    // Bootstrap admin + perf API key (idempotent) before workload runs
    const { PrismaClient } =
      await import('../../apps/cms/generated/prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString: cfg.perfDatabaseUrl });
    const prisma = new PrismaClient({ adapter });
    await ensurePerfDbBootstrap({
      prisma,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
    });
    await prisma.$disconnect();

    const started = Date.now();
    const r = await seedPerfData({ client: pg, articleCount });
    console.log(
      `[perf:seed] inserted ${r.inserted} entries in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
  } finally {
    await pg.end();
  }
}
