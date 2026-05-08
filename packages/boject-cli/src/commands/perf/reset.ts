import { Client } from 'pg';
import { resetPerfDb } from '../../perf/resetPerfDb.js';
import { confirmReset } from './shared/confirmReset.js';

export interface PerfResetClient {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
}

export interface PerfResetFlags {
  databaseUrl?: string;
  yes: boolean;
  allowDatabase?: string[];
  /** Test seam — inject a fake pg client */
  _testClient?: PerfResetClient;
}

/**
 * Truncates the perf-specific content tables. SQL transport only — there
 * is no HTTP equivalent because multi-instance "reset" is a contradiction
 * (no DELETE-ALL endpoint exists, and adding one is out of scope for #159).
 *
 * The destructive operation is gated by:
 *   1. Database name ends in _perf or _staging (override with --allow-database <name>)
 *   2. TTY confirmation prompt (bypass with --yes or non-TTY stdin)
 */
export async function runPerfReset(flags: PerfResetFlags): Promise<void> {
  if (!flags.databaseUrl) {
    throw new Error(
      'boject perf reset requires --database-url. ' +
        '(There is no HTTP equivalent — multi-instance reset is not supported.)'
    );
  }
  const confirmed = await confirmReset({
    databaseUrl: flags.databaseUrl,
    yes: flags.yes,
  });
  if (!confirmed) {
    throw new Error('Cancelled by operator');
  }
  const client: PerfResetClient =
    flags._testClient ??
    (new Client({
      connectionString: flags.databaseUrl,
    }) as unknown as PerfResetClient);
  await client.connect();
  try {
    await resetPerfDb({
      databaseUrl: flags.databaseUrl,
      runQuery: async (sql) => {
        await client.query(sql);
      },
      allowDatabase: flags.allowDatabase,
    });
    process.stderr.write(
      `[perf:reset] truncated ${redactUrl(flags.databaseUrl)}\n`
    );
  } finally {
    await client.end();
  }
}

function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//<redacted>@');
}
