import { Client } from 'pg';
import { pathToFileURL } from 'node:url';
import { loadNodeConfig } from '../lib/config-node';

export interface ResetOptions {
  databaseUrl: string;
  runQuery: (sql: string) => Promise<void>;
}

const TABLES_IN_ORDER = [
  'ContentEntryVersion',
  'ContentEntry',
  'ContentTypeField',
  'ContentType',
];

export async function resetPerfDb(opts: ResetOptions): Promise<void> {
  if (!/\/boject_perf(\?|$)/.test(opts.databaseUrl)) {
    throw new Error(
      `resetPerfDb refusing to run against non-perf database: ${opts.databaseUrl}`
    );
  }
  for (const table of TABLES_IN_ORDER) {
    await opts.runQuery(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cfg = loadNodeConfig();
  const client = new Client({ connectionString: cfg.perfDatabaseUrl });
  await client.connect();
  try {
    await resetPerfDb({
      databaseUrl: cfg.perfDatabaseUrl,
      runQuery: async (sql) => {
        await client.query(sql);
      },
    });
    console.log(`[perf:reset] truncated all tables in ${cfg.perfDatabaseUrl}`);
  } finally {
    await client.end();
  }
}
