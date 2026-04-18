import { Client } from 'pg';

export interface WaitForDbOptions {
  databaseUrl: string;
  timeoutMs: number;
  intervalMs: number;
  probe?: (url: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultProbe = async (url: string): Promise<void> => {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => {});
  }
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForDb(opts: WaitForDbOptions): Promise<void> {
  const probe = opts.probe ?? defaultProbe;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  const deadline = now() + opts.timeoutMs;
  let lastError: unknown;

  while (true) {
    try {
      await probe(opts.databaseUrl);
      return;
    } catch (err) {
      lastError = err;
    }

    if (now() >= deadline) {
      throw new Error(
        `waitForDb timed out after ${opts.timeoutMs}ms waiting for ${opts.databaseUrl}: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      );
    }

    await sleep(opts.intervalMs);
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const timeoutMs = Number(process.env.WAIT_FOR_DB_TIMEOUT_MS ?? '30000');
  const intervalMs = Number(process.env.WAIT_FOR_DB_INTERVAL_MS ?? '1000');

  console.log(`[wait-for-db] polling ${url} (timeout ${timeoutMs}ms)`);
  waitForDb({ databaseUrl: url, timeoutMs, intervalMs })
    .then(() => {
      console.log('[wait-for-db] database is reachable');
    })
    .catch((err) => {
      console.error(
        `[wait-for-db] ${err instanceof Error ? err.message : err}`
      );
      process.exit(1);
    });
}
