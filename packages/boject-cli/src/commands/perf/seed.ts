import { Client } from 'pg';
import { generatePerfData } from '../../perf/generate.js';
import { writeViaSql } from '../../perf/writeViaSql.js';
import { writeViaHttp } from '../../perf/writeViaHttp.js';
import { resetPerfDb } from '../../perf/resetPerfDb.js';
import { assertAllowedDatabase } from '../../perf/allowedDatabase.js';
import { fetchBundle } from './shared/fetchBundle.js';
import { loadBundleFile } from './shared/loadBundleFile.js';
import type { Bundle } from '../../vendor/contentBundleTypes.js';

export interface PerfSeedFlags {
  contentType: string;
  size: number;
  seed?: number;
  /** SQL transport */
  databaseUrl?: string;
  reset?: boolean;
  allowDatabase?: string[];
  /** HTTP transport */
  httpSeed?: boolean;
  concurrency?: number;
  /** Bundle source */
  bundle?: string;
  url?: string;
  apiKey?: string;
  /** UI */
  yes: boolean;
}

/**
 * Generates and writes perf seed data.
 *
 * Bundle source: `--bundle <path>` (validated via the same validateBundle
 * `boject schema validate` uses) or, by default, GET /api/schema/export.
 *
 * Transport: exactly one of `--database-url` (raw pg) or `--http-seed`
 * (REST POST/PUT). The two are mutually exclusive — pick the one that
 * matches the operator's deployment topology (see the spec).
 *
 * SQL transport refuses any database whose name doesn't end in
 * `_perf` / `_staging` unless --allow-database lists it,
 * mirroring resetPerfDb.
 */
export async function runPerfSeed(
  flags: PerfSeedFlags
): Promise<{ inserted: number }> {
  const hasSql = !!flags.databaseUrl;
  const hasHttp = flags.httpSeed === true;
  if (!hasSql && !hasHttp) {
    throw new Error(
      'boject perf seed requires either --database-url (SQL) or --http-seed (HTTP).'
    );
  }
  if (hasSql && hasHttp) {
    throw new Error(
      'boject perf seed accepts exactly one transport: --database-url OR --http-seed, not both.'
    );
  }
  if (hasSql) {
    assertAllowedDatabase(flags.databaseUrl!, flags.allowDatabase ?? []);
  }

  // Bundle source
  const bundle = await resolveBundle(flags);
  if (!bundle.contentTypes?.find((t) => t.identifier === flags.contentType)) {
    const available =
      bundle.contentTypes?.map((t) => t.identifier).join(', ') ?? '(none)';
    throw new Error(
      `Content type "${flags.contentType}" not found in bundle. Available: ${available}`
    );
  }

  // Generate
  const generated = generatePerfData(bundle, {
    contentTypeIdentifier: flags.contentType,
    count: flags.size,
    seed: flags.seed ?? 1,
  });
  for (const w of generated.warnings) {
    process.stderr.write(`[warn] ${w}\n`);
  }

  // Write
  if (hasSql) {
    const client = new Client({ connectionString: flags.databaseUrl! });
    await client.connect();
    try {
      if (flags.reset) {
        await resetPerfDb({
          databaseUrl: flags.databaseUrl!,
          runQuery: async (sql) => {
            await client.query(sql);
          },
          allowDatabase: flags.allowDatabase,
        });
        process.stderr.write(
          `[perf:seed] reset ${redactUrl(flags.databaseUrl!)}\n`
        );
      }
      const r = await writeViaSql(client, generated, { batchSize: 500 });
      process.stderr.write(`[perf:seed] inserted ${r.inserted} entries\n`);
      return r;
    } finally {
      await client.end();
    }
  } else {
    if (!flags.url || !flags.apiKey) {
      throw new Error(
        'HTTP seed requires --url and --api-key (or $BOJECT_API_KEY).'
      );
    }
    const r = await writeViaHttp({
      baseUrl: flags.url,
      apiKey: flags.apiKey,
      generated,
      concurrency: flags.concurrency,
      onProgress: (n, total) => {
        if (n % 100 === 0 || n === total) {
          process.stderr.write(`[perf:seed] inserted ${n} / ${total}\n`);
        }
      },
    });
    process.stderr.write(`[perf:seed] inserted ${r.inserted} entries\n`);
    return r;
  }
}

async function resolveBundle(flags: PerfSeedFlags): Promise<Bundle> {
  if (flags.bundle) {
    return loadBundleFile(flags.bundle);
  }
  if (!flags.url || !flags.apiKey) {
    throw new Error(
      'Bundle source unavailable: pass --bundle <path> or set --url + --api-key for /api/schema/export.'
    );
  }
  return fetchBundle({ baseUrl: flags.url, apiKey: flags.apiKey });
}

function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//<redacted>@');
}
